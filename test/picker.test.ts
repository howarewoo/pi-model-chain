import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { filterCatalog, targetReason } from "../src/catalog.ts";
import type { Target } from "../src/config.ts";
import { createModelPicker, type PickerOptions } from "../src/picker.ts";
import { catalog, KEY, keys, plain, theme } from "./tui-fixtures.ts";

function picker(options: Partial<PickerOptions> = {}, height = 22) {
  let result: Target | undefined;
  let finished = false;
  const component = createModelPicker(
    () => catalog,
    { title: "Add a step", taken: [], ...options },
    theme,
    keys,
    () => {},
    (value) => {
      result = value;
      finished = true;
    },
    () => height,
  );
  component.focused = true;
  return {
    send: (...data: string[]) => data.forEach((key) => component.handleInput?.(key)),
    type: (text: string) => [...text].forEach((key) => component.handleInput?.(key)),
    render: (width = 100) => plain(component.render(width)),
    get result() {
      return result;
    },
    get finished() {
      return finished;
    },
  };
}
const rowsOf = (lines: string[]) =>
  lines
    .filter((line) => /^│ [❯ ] \S+\/\S+/.test(line))
    .map((line) => line.slice(4).split(/\s+/)[0]);

test("catalog search covers name, provider label, provider and model ID", () => {
  for (const query of ["sonnet", "ANTHROPIC", "claude-sonnet-4-5"])
    assert.deepEqual(
      filterCatalog(catalog, query).map((entry) => entry.model),
      ["claude-sonnet-4-5"],
    );
  assert.equal(filterCatalog(catalog, "", "openai").length, 2);
  assert.deepEqual(filterCatalog(catalog, "no-such-model"), []);
});

test("target reasons reject virtual, unsupported, out-of-scope and duplicate targets, not missing auth", () => {
  const sonnet: Target = { provider: "anthropic", model: "claude-sonnet-4-5", effort: "high" };
  assert.equal(targetReason(catalog, sonnet), undefined);
  assert.match(
    targetReason(catalog, { provider: "chain", model: "work", effort: "off" })!,
    /Virtual/,
  );
  assert.match(targetReason(catalog, { ...sonnet, effort: "max" })!, /Unsupported effort/);
  assert.match(
    targetReason(catalog, { provider: "openai", model: "o4-mini", effort: "high" })!,
    /scope/,
  );
  assert.match(targetReason(catalog, sonnet, [sonnet])!, /Already in this chain/);
  assert.equal(
    targetReason(catalog, { provider: "openai", model: "gpt-4.1", effort: "off" }),
    undefined,
  );
  assert.match(targetReason(catalog, { provider: "x", model: "y", effort: "off" })!, /catalogue/);
});

test("search always has focus and filters live; provider tabs cycle with Tab and Shift+Tab", () => {
  const p = picker();
  assert.deepEqual(rowsOf(p.render()), [
    "anthropic/claude-sonnet-4-5",
    "openai/gpt-4.1",
    "openai/o4-mini",
    "chain/work",
  ]);
  p.type("gpt");
  assert.deepEqual(rowsOf(p.render()), ["openai/gpt-4.1"]);
  assert.ok(p.render().some((line) => line.includes("Search: gpt")));
  p.send("\x7f", "\x7f", "\x7f");
  p.send(KEY.tab);
  assert.deepEqual(rowsOf(p.render()), ["anthropic/claude-sonnet-4-5"]);
  p.send(KEY.tab);
  assert.deepEqual(rowsOf(p.render()), ["openai/gpt-4.1", "openai/o4-mini"]);
  p.send(KEY.shiftTab, KEY.shiftTab);
  assert.equal(rowsOf(p.render()).length, 4, "Shift+Tab wraps back to All");
});

test("rows show aligned context, cost, vision and auth indicators", () => {
  const lines = picker().render(100);
  const row = (id: string) => lines.find((line) => line.includes(id))!;
  assert.match(row("claude-sonnet-4-5"), /200k\s+\$3\/15\s+vision\s+auth ✓ │$/);
  assert.match(row("gpt-4.1"), /1m\s+\$2\/8\s+vision\s+no auth │$/);
  assert.match(row("chain/work"), /virtual │$/);
  const ends = ["claude-sonnet-4-5", "gpt-4.1", "o4-mini"].map((id) => visibleWidth(row(id)));
  assert.equal(new Set(ends).size, 1);
});

test("Enter opens an inline strip of supported efforts; a second Enter picks", () => {
  const p = picker({ preferredEffort: "medium" });
  p.send(KEY.enter);
  const strip = p.render().find((line) => line.includes("Effort"))!;
  assert.match(strip, /⦸ off\s+◔ low\s+\[◑ medium\]\s+◕ high/);
  assert.ok(!strip.includes("max"), "only the model's supported efforts appear");
  p.send(KEY.right, KEY.enter);
  assert.deepEqual(p.result, { provider: "anthropic", model: "claude-sonnet-4-5", effort: "high" });
});

test("ineligible models and efforts stay visible with an inline reason but cannot be picked", () => {
  const virtual = picker();
  virtual.type("chain");
  virtual.send(KEY.enter);
  assert.equal(virtual.finished, false);
  assert.ok(
    virtual.render().some((line) => line.includes("Virtual model; chains need physical targets")),
  );

  const scoped = picker();
  scoped.type("o4");
  scoped.send(KEY.enter, KEY.right, KEY.right);
  assert.ok(scoped.render().some((line) => line.includes("Not selectable: Outside this session")));
  scoped.send(KEY.enter);
  assert.equal(scoped.finished, false);

  const duplicate = picker({
    taken: [{ provider: "openai", model: "gpt-4.1", effort: "off" }],
  });
  duplicate.type("gpt");
  duplicate.send(KEY.enter);
  assert.equal(duplicate.finished, false);
  assert.ok(
    duplicate.render().some((line) => /Already in this chain|No eligible effort/.test(line)),
  );
});

test("Escape closes the effort strip first, then cancels without a selection", () => {
  const p = picker();
  p.send(KEY.enter, KEY.esc);
  assert.equal(p.finished, false);
  assert.ok(!p.render().some((line) => line.includes("Effort [")));
  p.send(KEY.esc);
  assert.equal(p.finished, true);
  assert.equal(p.result, undefined);
});

test("narrow widths keep the frame intact and drop optional columns before auth", () => {
  for (const width of [44, 50, 60, 80, 120]) {
    const lines = picker().render(width);
    for (const line of lines) assert.equal(visibleWidth(line), width, `width ${width}: ${line}`);
    assert.ok(lines.every((line) => /^[╭│╰]/.test(line)));
    assert.ok(lines.find((line) => line.includes("gpt-4.1"))!.includes("no auth"));
  }
  assert.ok(
    !picker()
      .render(50)
      .some((line) => line.includes("$3/15")),
    "price drops when narrow",
  );
  assert.ok(
    picker()
      .render(30)
      .some((line) => line.includes("Too small")),
  );
});
