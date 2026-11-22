import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  type Context,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

// pi-subagents is a test-only devDependency; PI_SUBAGENTS_CHECKOUT selects a local checkout
// (with its dependencies installed) instead. No runtime code or configuration is shared.
const subagents = resolve(
  process.env.PI_SUBAGENTS_CHECKOUT ?? "node_modules/@howarewoo/pi-subagents",
  "index.ts",
);
const chainEntry = resolve("index.ts");
const STATE = "model-chain.state.v1";

interface Child {
  id: string;
  generation: number;
  status: string;
  disposed: boolean;
  model?: unknown;
  fallback?: { index: number; failures: number; exhausted: boolean; [key: string]: unknown };
}
interface Run {
  dispatches: string[];
  children: Child[];
  errors: unknown[];
  parentState: () => { index: number; failures: number; exhausted: boolean } | undefined;
  prompt: (text: string) => Promise<string[]>;
  close: () => Promise<void>;
}

const userText = (context: Context) => {
  const user = context.messages.findLast((message) => message.role === "user");
  if (!user) return "";
  return typeof user.content === "string"
    ? user.content
    : user.content.map((block) => (block.type === "text" ? block.text : "")).join("");
};

// Parent targets are a/b, the subagent profile chain is c/d. A and C always fail.
async function start(options: { chain: boolean; subagents: boolean }): Promise<Run> {
  const root = await mkdtemp(join(tmpdir(), "chain-coexistence-"));
  const agentDir = join(root, "agent");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const dispatches: string[] = [];
  const children: Child[] = [];
  const errors: unknown[] = [];
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  const close = async () => {
    if (session) {
      await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    }
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  };
  try {
    await mkdir(agentDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    await writeFile(
      join(agentDir, "model-chain.json"),
      JSON.stringify({
        version: 1,
        chains: {
          parent: ["a", "b"].map((model) => ({ provider: "coexist", model, effort: "off" })),
        },
      }),
    );
    const targets = ["c", "d"].map((id) => ({ provider: "coexist", id, effort: "off" }));
    await writeFile(
      join(agentDir, "delegation.json"),
      JSON.stringify({
        general: { tools: ["read"], models: targets, fallback: targets, spawn: [] },
      }),
    );
    const settings = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 2, baseDelayMs: 1, provider: { maxRetries: 0 } },
    });
    const runtime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(agentDir, "models-store.json"),
      refreshOnCreate: false,
    });
    const provider = fauxProvider({
      provider: "coexist",
      models: ["a", "b", "c", "d"].map((id) => ({
        id,
        reasoning: false,
        contextWindow: 128000,
        maxTokens: 1024,
      })),
      tokensPerSecond: 0,
    });
    provider.setResponses(
      Array.from(
        { length: 64 },
        () => (context: Context, _options: unknown, _state: unknown, model: { id: string }) => {
          dispatches.push(model.id);
          if (model.id === "a" || model.id === "c")
            return fauxAssistantMessage("honest failed draft", {
              stopReason: "error",
              errorMessage: "503 service unavailable",
            });
          if (model.id === "d") return fauxAssistantMessage("child recovered on D");
          const answered = context.messages.at(-1)?.role === "toolResult";
          const request = userText(context);
          if (!answered && request.includes("delegate"))
            return fauxAssistantMessage(
              fauxToolCall("delegate_task", {
                profile: "general",
                assignment: "controlled child task",
                background: false,
                limits: { requests: 8, tools: 1, spawns: 0 },
              }),
              { stopReason: "toolUse" },
            );
          const child = children.at(-1);
          if (!answered && request.includes("reset child") && child)
            return fauxAssistantMessage(
              fauxToolCall("delegate_coordinate", {
                action: "reset_fallback",
                target: { id: child.id, generation: child.generation },
              }),
              { stopReason: "toolUse" },
            );
          return fauxAssistantMessage("parent answered on B");
        },
      ),
    );
    runtime.registerNativeProvider(provider.provider);
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
      additionalExtensionPaths: [
        ...(options.chain ? [chainEntry] : []),
        ...(options.subagents ? [subagents] : []),
      ],
      extensionFactories: [
        (pi) => {
          pi.events.on("delegation:registry", (event) => {
            const value = event as { child?: Child };
            if (value.child) children.push(structuredClone(value.child));
          });
        },
      ],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    session = (
      await createAgentSession({
        cwd: root,
        agentDir,
        modelRuntime: runtime,
        resourceLoader: loader,
        model: runtime.getModel("coexist", "b")!,
        settingsManager: settings,
        sessionManager: SessionManager.create(root, join(root, "sessions")),
        tools: ["read", ...(options.subagents ? ["delegate_task", "delegate_coordinate"] : [])],
      })
    ).session;
    await session.bindExtensions({
      mode: "print",
      onError: (error) => {
        errors.push(error);
      },
    });
    if (options.chain) await session.setModel(runtime.getModel("chain", "parent")!);
    const active = session;
    return {
      dispatches,
      children,
      errors,
      parentState: () => {
        const entry = active.sessionManager
          .getBranch()
          .findLast((item) => item.type === "custom" && item.customType === STATE);
        if (entry?.type !== "custom") return undefined;
        const { index, failures, exhausted } = entry.data as {
          index: number;
          failures: number;
          exhausted: boolean;
        };
        return { index, failures, exhausted };
      },
      async prompt(text) {
        const before = dispatches.length;
        await active.prompt(text);
        return dispatches.slice(before);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

const parentOnly = (calls: string[]) => calls.filter((id) => id === "a" || id === "b");
const childOnly = (calls: string[]) => calls.filter((id) => id === "c" || id === "d");
// Run-specific identities, paths and timestamps differ; routing behavior must not.
const behavior = (child: Child) => {
  const { status, model, effort, fallback, telemetry, result, progress, tools, toolCalls } =
    child as Child & Record<string, unknown>;
  return {
    status,
    model,
    effort,
    fallback,
    requests: (telemetry as { requests?: number } | undefined)?.requests,
    result,
    progress,
    tools,
    toolCalls,
  };
};
const settledChild = (run: Run) => {
  const child = run.children.at(-1);
  assert.ok(child, "expected a delegated child");
  return child;
};

test(
  "pi-model-chain chains and pi-subagents profile fallback chains stay independent",
  { timeout: 90_000 },
  async () => {
    // Baselines: each extension alone, with identical providers and scripts.
    const chainAlone = await start({ chain: true, subagents: false });
    let chainBaseline: string[];
    try {
      chainBaseline = await chainAlone.prompt("fall back");
      assert.deepEqual(chainBaseline, ["a", "a", "a", "b"]);
      assert.deepEqual(chainAlone.parentState(), { index: 1, failures: 0, exhausted: false });
      assert.deepEqual(chainAlone.errors, []);
    } finally {
      await chainAlone.close();
    }

    const subagentsAlone = await start({ chain: false, subagents: true });
    let delegateBaseline: string[];
    let childBaseline: Child;
    try {
      delegateBaseline = await subagentsAlone.prompt("delegate");
      childBaseline = settledChild(subagentsAlone);
      assert.deepEqual(childOnly(delegateBaseline), ["c", "c", "c", "d"]);
      assert.deepEqual(parentOnly(delegateBaseline), ["b", "b"]);
      assert.equal(childBaseline.status, "settled");
      assert.equal(childBaseline.fallback?.index, 1);
      assert.deepEqual(subagentsAlone.errors, []);
    } finally {
      await subagentsAlone.close();
    }

    const both = await start({ chain: true, subagents: true });
    try {
      // Parent recovery is unchanged by pi-subagents.
      assert.deepEqual(await both.prompt("fall back"), chainBaseline);
      assert.deepEqual(both.parentState(), { index: 1, failures: 0, exhausted: false });

      // The child's profile chain switches exactly as it does alone, and the parent's
      // sticky backup sends the same requests as the physical B parent did alone.
      const delegated = await both.prompt("delegate");
      assert.deepEqual(delegated, delegateBaseline);
      const child = settledChild(both);
      assert.deepEqual(behavior(child), behavior(childBaseline));
      // Child sessions load no ambient extensions: no pi-model-chain state or routing.
      const transcript = await readFile(
        String((child as Child & { transcript?: string }).transcript),
        "utf8",
      );
      assert.ok(transcript.includes("child recovered on D"));
      assert.ok(
        !transcript.includes("model-chain"),
        "child transcript must not contain model-chain state",
      );
      // Child failures never reach the parent chain's budget or position.
      assert.deepEqual(both.parentState(), { index: 1, failures: 0, exhausted: false });

      // Each reset affects only its own chain and sends no model request.
      assert.deepEqual(await both.prompt("/chain-reset"), []);
      assert.deepEqual(both.parentState(), { index: 0, failures: 0, exhausted: false });
      assert.equal(both.children.at(-1)?.fallback?.index, 1, "parent reset must not reset child D");

      const resetChild = await both.prompt("reset child");
      assert.deepEqual(childOnly(resetChild), [], "child reset sends no child request");
      assert.deepEqual(parentOnly(resetChild), ["a", "a", "a", "b", "b"]);
      assert.equal(both.children.at(-1)?.fallback?.index, 0, "child reset restores C");
      assert.deepEqual(both.parentState(), { index: 1, failures: 0, exhausted: false });
      assert.deepEqual(both.errors, []);
    } finally {
      await both.close();
    }
  },
);
