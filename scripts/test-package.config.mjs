// Per-repo values for the shared scripts/test-package.mjs smoke test.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(
  new URL("../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js", import.meta.url),
);
function pi(args, options) {
  const pending = execFileAsync(process.execPath, [cli, ...args], {
    timeout: 30_000,
    encoding: "utf8",
    ...options,
  });
  // Print mode reads piped stdin even with an explicit prompt.
  pending.child.stdin?.end();
  return pending;
}

const fixtureProvider = (dispatches) => `
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { appendFileSync } from 'node:fs';
export default function(pi) {
  pi.registerProvider('fixture', {
    api: 'openai-completions', apiKey: 'fixture-only', baseUrl: 'https://invalid.example',
    models: ['a', 'b'].map(id => ({ id, name: id, reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
    streamSimple(model) {
      appendFileSync(${JSON.stringify(dispatches)}, model.id + '\\n');
      const failed = model.id === 'a';
      const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content: [{ type: 'text', text: failed ? 'failed draft' : 'package recovery succeeded' }], stopReason: failed ? 'error' : 'stop', ...(failed ? { errorMessage: 'insufficient_quota' } : {}), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'start', partial: message });
      stream.push(failed ? { type: 'error', reason: 'error', error: message } : { type: 'done', reason: 'stop', message });
      stream.end();
      return stream;
    }
  });
}
`;

export default {
  // Every packed tar entry must match; anything else fails before installation.
  files:
    /^package\/(?:index\.ts|src\/[\w-]+\.ts|docs\/[\w-]+\.md|package\.json|README\.md|CHANGELOG\.md|LICENSE|SECURITY\.md)$/,
  requiredFiles: ["README.md", "CHANGELOG.md", "LICENSE"],
  // Without model-fallback.json the extension deliberately registers nothing.
  tools: [],
  commands: [],
  // With a chain configured, the installed package must register its commands and virtual
  // model, then recover A/A/A/B through real Pi in offline print mode.
  async verify({ installed, root }) {
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    const env = { ...process.env, PI_CODING_AGENT_DIR: agent };
    await writeFile(
      join(agent, "model-fallback.json"),
      JSON.stringify({
        version: 1,
        chains: {
          work: ["a", "b"].map((model) => ({ provider: "fixture", model, effort: "off" })),
        },
      }),
    );
    await writeFile(
      join(agent, "settings.json"),
      JSON.stringify({
        retry: { enabled: true, maxRetries: 2, baseDelayMs: 1, provider: { maxRetries: 0 } },
        compaction: { enabled: false },
      }),
    );
    const { DefaultResourceLoader, SettingsManager } =
      await import("@earendil-works/pi-coding-agent");
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: agent,
      settingsManager: SettingsManager.inMemory({ packages: [installed] }),
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const { errors, extensions } = loader.getExtensions();
    assert.deepEqual(errors, []);
    assert.deepEqual([...extensions[0].commands.keys()].sort(), [
      "fallback-reset",
      "fallback-status",
    ]);

    const install = await pi(["install", installed], { cwd: root, env });
    assert.ok((install.stdout + install.stderr).includes("Installed"));
    const settings = JSON.parse(await readFile(join(agent, "settings.json"), "utf8"));
    assert.ok(JSON.stringify(settings.packages).includes("pi-model-fallback"));
    const listed = await pi(["--offline", "--list-models", "fallback"], { cwd: root, env });
    assert.match(listed.stdout, /fallback\s+work/);
    assert.ok(!listed.stderr.includes("Failed to load"));

    const dispatches = join(root, "dispatches");
    const fixture = join(root, "fixture.ts");
    await writeFile(fixture, fixtureProvider(dispatches));
    const run = await pi(
      [
        "--offline",
        "--no-session",
        "--no-builtin-tools",
        "-e",
        fixture,
        "--model",
        "fallback/work",
        "-p",
        "Recover with the installed package",
      ],
      { cwd: root, env },
    );
    assert.match(run.stdout, /package recovery succeeded/);
    assert.equal(await readFile(dispatches, "utf8"), "a\na\na\nb\n");
    assert.ok(!run.stderr.includes("Extension Error"));
  },
};
