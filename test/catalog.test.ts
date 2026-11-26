import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { filterCatalog, readCatalog, targetReason } from "../src/catalog.ts";

type Ctx = Pick<ExtensionContext, "modelRegistry" | "scopedModels">;
const model = (provider: string, id: string, extra: Record<string, unknown> = {}) => ({
  provider,
  id,
  name: id,
  api: "anthropic-messages",
  reasoning: true,
  input: ["text"],
  contextWindow: 200_000,
  maxTokens: 64_000,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  ...extra,
});
const sonnet = model("anthropic", "claude-sonnet-4-5");
const haiku = model("anthropic", "claude-haiku-4-5");
const gpt = model("openai", "gpt-4.1", { reasoning: false });
const gemini = model("google", "gemini-2.5-pro");
const all = [sonnet, haiku, gpt, gemini];

function ctx(available: typeof all, scoped: { model: typeof sonnet; thinkingLevel?: string }[]) {
  return {
    modelRegistry: {
      getError: () => undefined,
      getAll: () => all,
      getAvailable: () => available,
      getProviderDisplayName: (provider: string) => provider,
      hasConfiguredAuth: (item: typeof sonnet) => available.includes(item),
    },
    scopedModels: scoped,
  } as unknown as Ctx;
}
const listed = (catalog: ReturnType<typeof readCatalog>) =>
  filterCatalog(catalog, "").map((entry) => `${entry.provider}/${entry.model}`);

test("without a scope the picker lists Pi's available models, like the built-in /model", () => {
  const catalog = readCatalog(ctx([sonnet, gpt], []));
  assert.deepEqual(listed(catalog), ["anthropic/claude-sonnet-4-5", "openai/gpt-4.1"]);
  // Unlisted models stay in the catalogue, so existing steps are not marked for missing auth.
  assert.equal(
    targetReason(catalog, { provider: "google", model: "gemini-2.5-pro", effort: "high" }),
    undefined,
  );
});

test("with a scope the picker lists only scoped models, honouring a pinned effort", () => {
  const catalog = readCatalog(
    ctx(all, [{ model: sonnet }, { model: haiku, thinkingLevel: "high" }, { model: gpt }]),
  );
  assert.deepEqual(listed(catalog), [
    "anthropic/claude-sonnet-4-5",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-4.1",
  ]);
  const efforts = (id: string) =>
    catalog.entries
      .find((entry) => entry.model === id)!
      .efforts.filter((item) => !item.reason)
      .map((item) => item.effort);
  assert.deepEqual(efforts("claude-haiku-4-5"), ["high"]);
  assert.ok(efforts("claude-sonnet-4-5").length > 1, "an unpinned scope keeps every effort");
  // Existing out-of-scope steps are still marked in the /chain list and editor.
  assert.match(
    targetReason(catalog, { provider: "google", model: "gemini-2.5-pro", effort: "high" })!,
    /Outside this session's model\/effort scope/,
  );
  assert.match(
    targetReason(catalog, { provider: "anthropic", model: "claude-haiku-4-5", effort: "low" })!,
    /Outside/,
  );
});

test("a scope pinning an effort the model does not support lists nothing for it", () => {
  const catalog = readCatalog(ctx(all, [{ model: gpt, thinkingLevel: "high" }]));
  assert.deepEqual(listed(catalog), []);
});
