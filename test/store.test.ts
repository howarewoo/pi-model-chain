import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Config } from "../src/config.ts";
import { formatStatus, badges, stepMarks } from "../src/status.ts";
import { readConfigFile, writeConfigFile } from "../src/store.ts";

const work: Config = {
  version: 1,
  chains: {
    work: [
      { provider: "a", model: "one", effort: "high" },
      { provider: "b", model: "two", effort: "off" },
    ],
  },
};

async function directory(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "model-chain-store-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, path: join(dir, "model-chain.json") };
}

test("a missing config reads as no chains; saving creates a private, valid file", async (t) => {
  const { dir, path } = await directory(t);
  const empty = await readConfigFile(path);
  assert.deepEqual(Object.keys(empty.config.chains), []);
  assert.equal(empty.raw, undefined);
  const raw = await writeConfigFile(path, work, undefined);
  assert.equal(await readFile(path, "utf8"), raw);
  assert.deepEqual(JSON.parse(JSON.stringify((await readConfigFile(path)).config)), work);
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(dir), ["model-chain.json"], "no temporary file is left behind");
});

test("saving never overwrites a file that changed on disk", async (t) => {
  const { path } = await directory(t);
  const raw = await writeConfigFile(path, work, undefined);
  await writeFile(path, `${raw}\n`);
  await assert.rejects(writeConfigFile(path, work, raw), /changed on disk/);
  await assert.rejects(writeConfigFile(path, work, undefined), /changed on disk/);
});

test("invalid configs are rejected before the file is replaced", async (t) => {
  const { path } = await directory(t);
  const raw = await writeConfigFile(path, work, undefined);
  const invalid = { version: 1, chains: { "bad name": work.chains.work } } as Config;
  await assert.rejects(writeConfigFile(path, invalid, raw), /Invalid or empty chain/);
  assert.equal(await readFile(path, "utf8"), raw);
});

test("deleting the last chain removes the file", async (t) => {
  const { path } = await directory(t);
  const raw = await writeConfigFile(path, work, undefined);
  assert.equal(await writeConfigFile(path, { version: 1, chains: {} }, raw), undefined);
  await assert.rejects(readFile(path));
});

test("status text is readable, marks each step and never dumps JSON", () => {
  const view = {
    name: "work",
    targets: work.chains.work,
    active: true,
    state: {
      index: 1,
      failures: 1,
      exhausted: false,
      skipped: [{ target: "a/one:high", reason: "no configured authentication" }],
    },
  };
  const lines = formatStatus({ view, chains: ["work"] });
  assert.equal(lines[0], "Chain work (chain/work) · selected · retry 1/2 · 1 skipped · on step 2");
  assert.equal(lines[1], "  ↷ 1. a/one:high  skipped");
  assert.equal(lines[2], "  ▶ 2. b/two:off  active · 1 of 2 retries used");
  assert.match(lines.join("\n"), /Skipped a\/one:high: no configured authentication/);
  assert.ok(!lines.some((line) => line.trimStart().startsWith("{")));

  assert.deepEqual(stepMarks({ name: "work", targets: work.chains.work }), ["active", "pending"]);
  assert.deepEqual(badges({ name: "work", targets: work.chains.work }), ["ready"]);
  const exhausted = { ...view, state: { ...view.state, index: 1, exhausted: true, skipped: [] } };
  assert.deepEqual(stepMarks(exhausted), ["done", "exhausted"]);
  assert.ok(badges(exhausted).includes("exhausted · reset required"));
  assert.ok(badges({ ...view, changed: true }).includes("changed · reset required"));
  assert.match(formatStatus({ chains: [] })[0], /No chains configured/);
  assert.match(formatStatus({ chains: ["work"], problem: "boom" }).join("\n"), /Problem: boom/);
});
