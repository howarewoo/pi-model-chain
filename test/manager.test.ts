import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Config } from "../src/config.ts";
import { createChainManager, draftProblem, type ManagerSnapshot } from "../src/manager.ts";
import type { ChainView } from "../src/status.ts";
import { catalog, KEY, keys, plain, theme } from "./tui-fixtures.ts";

const sonnet = { provider: "anthropic", model: "claude-sonnet-4-5", effort: "high" } as const;
const gpt = { provider: "openai", model: "gpt-4.1", effort: "off" } as const;
const mini = { provider: "openai", model: "o4-mini", effort: "low" } as const;

function manager(options: { idle?: boolean; active?: string; height?: number } = {}) {
  let config: Config = { version: 1, chains: { work: [sonnet, gpt], cheap: [mini] } };
  let raw = "initial";
  const calls: string[] = [];
  const saved: Config[] = [];
  let closed = false;
  const views = (): ChainView[] =>
    Object.entries(config.chains).map(([name, targets]) => ({
      name,
      targets,
      active: name === options.active,
      state: name === "work" ? { index: 1, failures: 1, exhausted: false, skipped: [] } : undefined,
    }));
  const snapshot = (): ManagerSnapshot => ({ config, raw, views: views() });
  const component = createChainManager(
    {
      read: async () => snapshot(),
      catalog: () => catalog,
      idle: () => options.idle ?? true,
      async save(next, expected) {
        assert.equal(expected, raw, "save passes the content it was read from");
        saved.push(next);
        config = next;
        raw = `saved ${saved.length}`;
      },
      async activate(name) {
        calls.push(`activate ${name}`);
      },
      reset(name) {
        calls.push(`reset ${name}`);
      },
    },
    snapshot(),
    theme,
    keys,
    () => {},
    () => {
      closed = true;
    },
    () => options.height ?? 24,
  );
  component.focused = true;
  return {
    calls,
    saved,
    send: async (...data: string[]) => {
      for (const key of data) component.handleInput?.(key);
      await tick();
      await tick();
    },
    type: async (text: string) => {
      for (const key of text) component.handleInput?.(key);
      await tick();
    },
    render: (width = 100) => plain(component.render(width)),
    get closed() {
      return closed;
    },
  };
}
const text = (lines: string[]) => lines.join("\n");

test("chain rows show the ordered steps, active step and status badges", () => {
  const m = manager({ active: "work" });
  const screen = text(m.render());
  assert.match(screen, /❯ work \[selected\] \[retry 1\/2\] \[on step 2\]/);
  assert.match(screen, /anthropic\/claude-sonnet-4-5:high → openai\/gpt-4\.1:off/);
  assert.match(screen, /cheap \[ready\]/);
});

test("type to filter, arrows to move, Enter selects the chain and closes", async () => {
  const m = manager();
  await m.type("mini");
  const screen = text(m.render());
  assert.ok(screen.includes("cheap") && !screen.includes("❯ work"));
  await m.send(KEY.enter);
  assert.deepEqual(m.calls, ["activate cheap"]);
  assert.equal(m.closed, true);

  const n = manager();
  await n.send(KEY.down, KEY.enter);
  assert.deepEqual(n.calls, ["activate cheap"]);
});

test("create a chain: name it, add steps with the picker, reorder and save atomically", async () => {
  const m = manager();
  await m.send(KEY.ctrl("n"));
  assert.match(text(m.render()), /New chain/);
  await m.type("fast");
  await m.send(KEY.ctrl("n")); // add a step: picker opens
  assert.match(text(m.render()), /Add a step/);
  await m.type("gpt");
  await m.send(KEY.enter, KEY.enter); // choose gpt-4.1, pick its only effort
  await m.send("a"); // add after the selected step
  await m.type("sonnet");
  await m.send(KEY.enter, KEY.enter); // the strip starts on the first effort above off
  let screen = text(m.render());
  assert.match(screen, /1\.\s+openai\/gpt-4\.1:off[\s\S]*2\.\s+anthropic\/claude-sonnet-4-5:low/);
  await m.send(KEY.shiftUp);
  screen = text(m.render());
  assert.match(screen, /1\.\s+anthropic\/claude-sonnet-4-5:low[\s\S]*2\.\s+openai\/gpt-4\.1:off/);
  await m.send(KEY.ctrl("s"));
  assert.equal(m.saved.length, 1);
  assert.deepEqual(m.saved[0].chains.fast, [
    { provider: "anthropic", model: "claude-sonnet-4-5", effort: "low" },
    { provider: "openai", model: "gpt-4.1", effort: "off" },
  ]);
  assert.deepEqual(Object.keys(m.saved[0].chains).sort(), ["cheap", "fast", "work"]);
  screen = text(m.render());
  assert.match(screen, /Saved fast/);
  assert.match(screen, /❯ fast/);
});

test("edit, replace and remove steps; Escape keeps unsaved edits until confirmed", async () => {
  const m = manager();
  await m.send(KEY.ctrl("e"));
  assert.match(text(m.render()), /Edit chain work/);
  await m.send(KEY.down, "x");
  assert.ok(!text(m.render()).includes("gpt-4.1"));
  await m.send(KEY.enter); // replace the remaining step through the picker
  await m.type("mini");
  await m.send(KEY.enter);
  assert.match(text(m.render()), /\[◔ low\]/, "the strip starts on an eligible effort");
  await m.send(KEY.esc); // close the strip
  await m.send(KEY.esc); // leave the picker: the editor and its edits remain
  assert.match(text(m.render()), /Edit chain work \*/);
  await m.send(KEY.esc);
  assert.match(text(m.render()), /Unsaved changes/);
  await m.send(KEY.esc);
  assert.match(text(m.render()), /Model chains/);
  assert.equal(m.saved.length, 0);
});

test("saving validates names, duplicates and empty chains inline", async () => {
  const config: Config = { version: 1, chains: { work: [sonnet] } };
  assert.match(draftProblem({ name: "bad name", steps: [sonnet] }, config, catalog)!, /Name must/);
  assert.match(draftProblem({ name: "work", steps: [sonnet] }, config, catalog)!, /already exists/);
  assert.match(draftProblem({ name: "new", steps: [] }, config, catalog)!, /at least one step/);
  assert.match(
    draftProblem({ name: "new", steps: [sonnet, sonnet] }, config, catalog)!,
    /Already in this chain/,
  );
  assert.match(
    draftProblem(
      { name: "new", steps: [{ provider: "chain", model: "work", effort: "off" }] },
      config,
      catalog,
    )!,
    /Virtual/,
  );
  assert.match(
    draftProblem({ original: "work", name: "renamed", steps: [sonnet] }, config, catalog, "work")!,
    /Select another model before renaming/,
  );
  assert.equal(draftProblem({ name: "new", steps: [sonnet, gpt] }, config, catalog), undefined);

  const m = manager();
  await m.send(KEY.ctrl("n"));
  await m.type("work");
  await m.send(KEY.ctrl("s"));
  assert.match(text(m.render()), /already exists/);
  assert.equal(m.saved.length, 0);
});

test("delete asks for confirmation and refuses the selected chain", async () => {
  const m = manager({ active: "work" });
  await m.send(KEY.ctrl("d"));
  assert.match(text(m.render()), /Delete chain work\? Press y/);
  await m.send("y");
  assert.match(text(m.render()), /Select another model before deleting/);
  await m.send(KEY.down, KEY.ctrl("d"), "n");
  assert.equal(m.saved.length, 0);
  await m.send(KEY.ctrl("d"), "y");
  assert.deepEqual(Object.keys(m.saved[0].chains), ["work"]);
  assert.match(text(m.render()), /Deleted cheap/);
});

test("reset requires an idle session and resets only the highlighted chain", async () => {
  const busy = manager({ idle: false });
  await busy.send(KEY.ctrl("r"));
  assert.match(text(busy.render()), /Reset requires an idle session/);
  assert.deepEqual(busy.calls, []);
  const idle = manager();
  await idle.send(KEY.down, KEY.ctrl("r"));
  assert.deepEqual(idle.calls, ["reset cheap"]);
  assert.match(text(idle.render()), /Reset cheap/);
});

test("narrow widths keep every line inside the frame", async () => {
  for (const width of [40, 52, 72, 100, 140]) {
    const m = manager({ active: "work" });
    for (const lines of [m.render(width)]) {
      for (const line of lines) assert.equal(visibleWidth(line), width, `width ${width}: ${line}`);
    }
    await m.send(KEY.ctrl("e"));
    for (const line of m.render(width)) assert.equal(visibleWidth(line), width);
  }
  assert.match(text(manager().render(30)), /Too small/);
  assert.match(text(manager({ height: 6 }).render(80)), /Too small/);
});
