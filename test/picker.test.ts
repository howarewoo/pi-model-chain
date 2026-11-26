import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { filterCatalog, targetReason, type Catalog } from "../src/catalog.ts";
import type { Target } from "../src/config.ts";
import { createModelPicker, type PickerOptions } from "../src/picker.ts";
import { catalog, KEY, keys, longCatalog, plain, theme } from "./tui-fixtures.ts";

function picker(
  options: Partial<PickerOptions> = {},
  height = 22,
  read: () => Catalog = () => catalog,
) {
  let result: Target | undefined;
  let finished = false;
  const component = createModelPicker(
    read,
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
/** The model column: right of the provider divider when split, else the whole body. */
const modelColumn = (lines: string[]) =>
  lines.map((line) => {
    const [left, right] = line.split(" │ ");
    return right === undefined ? left.slice(2, -2) : right.slice(0, -2);
  });
const rowsOf = (lines: string[]) =>
  modelColumn(lines)
    .filter((line) => /^[❯› ] \S/.test(line) && !/^. Provider /.test(line))
    .map((line) => line.slice(2).split(/\s+/)[0]);

test("catalog search covers name, provider label, provider and model ID", () => {
  for (const query of ["sonnet", "ANTHROPIC", "claude-sonnet-4-5"])
    assert.deepEqual(
      filterCatalog(catalog, query).map((entry) => entry.model),
      ["claude-sonnet-4-5"],
    );
  assert.equal(filterCatalog(catalog, "", "openai").length, 2);
  assert.deepEqual(filterCatalog(catalog, "no-such-model"), []);
  assert.deepEqual(filterCatalog(catalog, "gemini"), [], "unlisted models are not searchable");
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

test("search filters live; ←/→ switch columns and ↑/↓ choose the provider", () => {
  const p = picker();
  assert.ok(
    !p.render().some((line) => /google|gemini/.test(line)),
    "models outside Pi's set and their providers are hidden, not shown disabled",
  );
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
  p.send(KEY.left, KEY.down);
  assert.deepEqual(rowsOf(p.render()), ["claude-sonnet-4-5"], "a provider's rows show the ID");
  p.send(KEY.down);
  assert.deepEqual(rowsOf(p.render()), ["gpt-4.1", "o4-mini"]);
  p.send(KEY.down, KEY.down);
  assert.deepEqual(rowsOf(p.render()), ["work"], "no row for a provider with no listed model");
  p.send(KEY.up, KEY.up, KEY.up, KEY.up);
  assert.equal(rowsOf(p.render()).length, 4, "All is first");
  p.send(KEY.tab);
  assert.equal(rowsOf(p.render()).length, 4, "Tab no longer switches providers");

  // ↑/↓ in the provider column never move the model cursor; → returns to it.
  const q = picker();
  q.send(KEY.left, KEY.down, KEY.down, KEY.right, KEY.down);
  assert.ok(modelColumn(q.render()).some((line) => line.startsWith("❯ o4-mini")));
  q.send(KEY.left, KEY.up, KEY.enter);
  assert.ok(modelColumn(q.render()).some((line) => line.startsWith("❯ claude-sonnet-4-5")));
  q.send(KEY.left, KEY.down);
  q.type("mini");
  assert.ok(
    modelColumn(q.render()).some((line) => line.startsWith("❯ o4-mini")),
    "typing edits the search and returns focus to the models",
  );
});

test("hints follow focus and match the bindings", () => {
  const p = picker({}, 22);
  const footer = () => p.render(120).slice(-3).join("\n");
  assert.match(footer(), /type to search · ↑\/↓ move · ← providers · ⏎ choose effort · esc cancel/);
  p.send(KEY.left);
  assert.match(footer(), /↑\/↓ provider · →\/⏎ models · type to search · esc cancel/);
  p.send(KEY.right, KEY.enter);
  assert.match(footer(), /←\/→ effort · ⏎ pick · esc back to models/);
  assert.ok(!p.render(120).some((line) => line.includes("Tab")));
});

test("the provider column lists All first with match counts", () => {
  const p = picker();
  const column = () =>
    p
      .render()
      .map((line) => line.split(" │ ")[0].slice(2).trimEnd())
      .filter((line) => /\d$/.test(line));
  assert.deepEqual(column(), ["› All       4", "  anthropic 1", "  openai    2", "  chain     1"]);
  p.type("o4");
  assert.deepEqual(column(), ["› All       1", "  anthropic 0", "  openai    1", "  chain     0"]);
  p.send(KEY.left);
  assert.equal(column()[0], "❯ All       1", "the focused column shows the accent cursor");
});

test("frames at 120x32, 80x24, 72 columns and compact 60x16 fill exactly", () => {
  for (const [width, height, split] of [
    [120, 32, true],
    [80, 24, true],
    [72, 20, true],
    [71, 20, false],
    [60, 16, false],
  ] as const) {
    const lines = picker({}, height).render(width);
    assert.equal(lines.length, height, `${width}x${height} rows`);
    for (const line of lines) assert.equal(visibleWidth(line), width, `${width}: ${line}`);
    assert.equal(
      lines.some((line) => line.includes("┴")),
      split,
      `${width}: split`,
    );
    assert.equal(lines[1].includes("Providers"), split);
    assert.equal(lines[1].includes("Provider All · 4 models · 1/4"), !split);
  }
});

test("80x24 frame", () => {
  const p = picker({}, 24);
  p.send(KEY.down);
  assert.equal(
    p.render(80).join("\n"),
    [
      "╭─ Add a step ─────────────────────────────────────────────────────────────────╮",
      "│ Providers     │ Search: name, provider or ID                                 │",
      "│               │                                                              │",
      "│ › All       4 │   anthro…/claude-sonnet-4-5  200k     $3/15  vision   auth ✓ │",
      "│   anthropic 1 │ ❯ openai/gpt-4.1               1m      $2/8  vision  no auth │",
      "│   openai    2 │   openai/o4-mini             200k  $1.1/4.4           auth ✓ │",
      "│   chain     1 │   chain/work                                 vision  virtual │",
      ...Array(13).fill(
        "│               │                                                              │",
      ),
      "├───────────────┴──────────────────────────────────────────────────────────────┤",
      "│ GPT-4.1 · 1m context · 33k output · $2/8 per M tokens · vision · no auth: s… │",
      "│ type to search · ↑/↓ move · ← providers · ⏎ choose effort · esc cancel       │",
      "╰──────────────────────────────────────────────────────────────────────────────╯",
    ].join("\n"),
  );
});

test("compact 60x16 frame keeps a one-line provider row with the same keys", () => {
  const p = picker({}, 16);
  p.send(KEY.left, KEY.down, KEY.down);
  assert.equal(
    p.render(60).join("\n"),
    [
      "╭─ Add a step ─────────────────────────────────────────────╮",
      "│ ❯ Provider openai · 2 models · 3/4                       │",
      "│ Search: name, provider or ID                             │",
      "│                                                          │",
      "│ › gpt-4.1                          1m      $2/8  no auth │",
      "│   o4-mini                        200k  $1.1/4.4   auth ✓ │",
      ...Array(6).fill("│                                                          │"),
      "├──────────────────────────────────────────────────────────┤",
      "│ GPT-4.1 · 1m context · 33k output · $2/8 per M tokens ·… │",
      "│ ↑/↓ provider · →/⏎ models · type to search · esc cancel  │",
      "╰──────────────────────────────────────────────────────────╯",
    ].join("\n"),
  );
});

test("long model IDs keep the ID visible and never overflow the frame", () => {
  for (const [width, height] of [
    [120, 32],
    [80, 24],
    [60, 16],
  ] as const) {
    const p = picker({}, height, () => longCatalog);
    const all = p.render(width);
    for (const line of all) assert.equal(visibleWidth(line), width);
    const row = modelColumn(all).find((line) => line.includes("us.anthropic"))!;
    if (width === 120)
      assert.match(row, /amazon-bedrock\/us\.anthropic\.claude-sonnet-4-5-20250929-v1:0 /);
    else assert.match(row, /…\/us\.anthropic\.claude-sonn?e?…/, "the provider is clipped first");
    p.send(KEY.left, KEY.down, KEY.down, KEY.down, KEY.down, KEY.right);
    const own = p.render(width);
    for (const line of own) assert.equal(visibleWidth(line), width);
    const [id] = rowsOf(own);
    assert.ok(id.startsWith("us.anthropic.claude-sonnet"), "a selected provider is implied");
    if (width === 120) assert.equal(id, "us.anthropic.claude-sonnet-4-5-20250929-v1:0");
  }
});

test("empty search results explain what to change", () => {
  for (const width of [120, 80, 60]) {
    const none = picker({}, 24);
    none.type("zzz");
    const lines = none.render(width);
    assert.ok(lines.some((line) => line.includes("No matching models. Change the search.")));
    assert.ok(!lines.some((line) => line.includes("Not selectable")));
  }
  const p = picker({}, 24);
  p.send(KEY.left, KEY.down, KEY.down, KEY.right);
  p.type("sonnet");
  const lines = p.render(120);
  assert.ok(
    lines.some((line) =>
      line.includes("No openai models match. ← to pick another provider, or change the search."),
    ),
  );
  assert.ok(lines.some((line) => /› openai\s+0/.test(line)));
  assert.ok(lines.some((line) => /anthropic\s+1/.test(line)));
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

  const duplicate = picker({
    taken: [{ provider: "openai", model: "gpt-4.1", effort: "off" }],
  });
  duplicate.type("gpt");
  duplicate.send(KEY.enter);
  assert.equal(duplicate.finished, false);
  assert.ok(duplicate.render().some((line) => line.includes("Already in this chain")));

  const taken = picker({
    taken: (["off", "low", "medium", "high"] as const).map((effort) => ({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      effort,
    })),
  });
  taken.send(KEY.enter);
  assert.ok(taken.render().some((line) => line.includes("Every effort is already in this chain")));
  assert.ok(!taken.render().some((line) => /scope/i.test(line)));
});

test("the effort strip offers only efforts in the session scope", () => {
  const p = picker();
  p.type("o4");
  p.send(KEY.enter);
  const strip = p.render().find((line) => line.includes("Effort"))!;
  assert.match(strip, /Effort \[◔ low\]\s+◑ medium\s+│$/);
  assert.ok(!strip.includes("high"), "an out-of-scope effort is hidden");
  p.send(KEY.right, KEY.right, KEY.right);
  assert.ok(!p.render().some((line) => /Not selectable|scope/i.test(line)));
  p.send(KEY.enter);
  assert.deepEqual(p.result, { provider: "openai", model: "o4-mini", effort: "medium" });
});

test("picking rechecks a fresh snapshot and refuses a model that lost scope or auth", () => {
  let current: Catalog = catalog;
  const p = picker({}, 22, () => current);
  p.send(KEY.enter);
  current = {
    entries: catalog.entries.map((entry) =>
      entry.model === "claude-sonnet-4-5" ? { ...entry, listed: false } : entry,
    ),
  };
  p.send(KEY.enter);
  assert.equal(p.finished, false);
  assert.ok(p.render().some((line) => line.includes("No longer available in this session")));
  assert.ok(!rowsOf(p.render()).includes("anthropic/claude-sonnet-4-5"));

  current = catalog;
  const narrowed = picker({}, 22, () => current);
  narrowed.send(KEY.enter);
  current = {
    entries: catalog.entries.map((entry) =>
      entry.model === "claude-sonnet-4-5"
        ? {
            ...entry,
            efforts: entry.efforts.map((item) =>
              item.effort === "high" ? item : { ...item, reason: "Outside scope" },
            ),
          }
        : entry,
    ),
  };
  narrowed.send(KEY.enter);
  assert.equal(narrowed.finished, false, "the chosen effort left the scope");
});

test("Escape closes the effort strip first, then cancels without a selection", () => {
  const p = picker();
  p.send(KEY.enter, KEY.esc);
  assert.equal(p.finished, false);
  assert.ok(!p.render().some((line) => line.includes("Effort [")));
  p.send(KEY.esc);
  assert.equal(p.finished, true);
  assert.equal(p.result, undefined);
  const providers = picker();
  providers.send(KEY.left, KEY.esc);
  assert.equal(providers.finished, true, "Escape also cancels from the provider column");
});

test("narrow widths keep the frame intact and drop optional columns before auth", () => {
  for (const width of [44, 50, 60, 80, 120]) {
    const lines = picker().render(width);
    for (const line of lines) assert.equal(visibleWidth(line), width, `width ${width}: ${line}`);
    assert.ok(lines.every((line) => /^[╭│├╰]/.test(line)));
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
