import {
  Input,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";
import { targetReason, type Catalog } from "./catalog.ts";
import { identity, type Config, type Target } from "./config.ts";
import { createModelPicker } from "./picker.ts";
import {
  cell,
  frame,
  hints,
  keyText,
  safe,
  type PanelKeys,
  type PanelTheme,
} from "./presentation.ts";
import { badges, stepMarks, type ChainView } from "./status.ts";

export interface ManagerSnapshot {
  config: Config;
  /** File content the snapshot was read from; saving refuses to overwrite anything else. */
  raw?: string;
  views: ChainView[];
}
export interface ManagerDeps {
  read(): Promise<ManagerSnapshot>;
  catalog(): Catalog;
  idle(): boolean;
  /** Validate, write atomically and refresh the registered chain models. */
  save(config: Config, expected: string | undefined): Promise<void>;
  activate(name: string): Promise<void>;
  reset(name: string): void;
}

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

interface Draft {
  original?: string;
  name: Input;
  steps: Target[];
  /** 0 is the name row; 1..n are steps. */
  cursor: number;
  dirty: boolean;
  discard: boolean;
}

/** Problems that block saving a draft; missing catalogue entries are allowed (runtime skips). */
export function draftProblem(
  draft: { original?: string; name: string; steps: readonly Target[] },
  config: Config,
  catalog: Catalog,
  active?: string,
): string | undefined {
  if (!NAME.test(draft.name))
    return "Name must start with a letter or digit and use only letters, digits, _ or -";
  if (draft.name !== draft.original && Object.hasOwn(config.chains, draft.name))
    return `A chain named ${draft.name} already exists`;
  if (draft.original && draft.original === active && draft.name !== draft.original)
    return "Select another model before renaming the selected chain";
  if (!draft.steps.length) return "Add at least one step";
  for (const [index, step] of draft.steps.entries()) {
    const why = targetReason(catalog, step, draft.steps.slice(0, index));
    if (why && why !== "Not in the model catalogue" && !why.startsWith("Outside"))
      return `Step ${index + 1} (${identity(step)}): ${why}`;
  }
  return undefined;
}

/**
 * The /chain overlay: browse, filter, activate, create, edit, reorder, reset and delete chains.
 * The search input has focus in the list; the editor and model picker take over the same frame.
 */
export function createChainManager(
  deps: ManagerDeps,
  initial: ManagerSnapshot,
  theme: PanelTheme,
  keys: PanelKeys,
  requestRender: () => void,
  done: () => void,
  rows: () => number,
): Component & Focusable {
  let snapshot = initial;
  const search = new Input({ prompt: "Search: ", placeholder: "chain name or model" });
  let mode: "list" | "confirm" | "edit" | "pick" = "list";
  let selected = 0;
  let notice = "";
  let busy = false;
  let focused = false;
  let draft: Draft | undefined;
  let picker: (Component & Focusable) | undefined;
  let width = 80;
  const active = () => snapshot.views.find((view) => view.active)?.name;
  const visible = () => {
    const needle = search.getValue().trim().toLocaleLowerCase();
    return snapshot.views.filter((view) =>
      `${view.name} ${view.targets.map(identity).join(" ")}`.toLocaleLowerCase().includes(needle),
    );
  };
  const current = () => visible()[Math.max(0, Math.min(selected, visible().length - 1))];
  const run = (task: () => Promise<void>, after?: () => void) => {
    busy = true;
    task()
      .then(after)
      .catch((error: unknown) => {
        notice = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        busy = false;
        requestRender();
      });
  };
  const reload = async (message: string) => {
    snapshot = await deps.read();
    notice = message;
  };
  const edit = (view?: ChainView) => {
    const name = new Input({ prompt: "Name: ", placeholder: "letters, digits, _ or -" });
    name.setValue(view?.name ?? "");
    draft = {
      original: view?.name,
      name,
      steps: [...(view?.targets ?? [])],
      cursor: view ? 1 : 0,
      dirty: false,
      discard: false,
    };
    mode = "edit";
    notice = view ? "" : "Name the chain, then add steps with ^N";
    syncFocus();
  };
  const openPicker = (replace: boolean) => {
    if (!draft) return;
    const at = draft.cursor - 1;
    const replacing = replace && at >= 0 ? draft.steps[at] : undefined;
    const taken = draft.steps.filter((_, index) => !(replacing && index === at));
    picker = createModelPicker(
      deps.catalog,
      {
        title: replacing ? `Replace step ${at + 1}` : "Add a step",
        taken,
        preferredEffort: replacing?.effort,
      },
      theme,
      keys,
      requestRender,
      (target) => {
        if (draft && target) {
          if (replacing) draft.steps[at] = target;
          else {
            const index = Math.max(0, draft.cursor);
            draft.steps.splice(index, 0, target);
            draft.cursor = index + 1;
          }
          draft.dirty = true;
          draft.discard = false;
          notice = "";
        }
        picker = undefined;
        mode = "edit";
        syncFocus();
        requestRender();
      },
      rows,
    );
    mode = "pick";
    syncFocus();
  };
  const save = () => {
    if (!draft) return;
    const name = draft.name.getValue().trim();
    const why = draftProblem(
      { original: draft.original, name, steps: draft.steps },
      snapshot.config,
      deps.catalog(),
      active(),
    );
    if (why) {
      notice = why;
      return;
    }
    if (!deps.idle()) {
      notice = "Saving requires an idle session";
      return;
    }
    const chains = { ...snapshot.config.chains };
    if (draft.original) delete chains[draft.original];
    chains[name] = draft.steps.map((step) => ({ ...step }));
    // Saving and the re-read both run under `busy`, so keys never act on a stale snapshot and a
    // failed re-read becomes a notice instead of an unhandled rejection.
    run(async () => {
      await deps.save({ version: 1, chains }, snapshot.raw);
      draft = undefined;
      mode = "list";
      search.setValue("");
      await reload(`Saved ${name}`);
      selected = Math.max(
        0,
        snapshot.views.findIndex((view) => view.name === name),
      );
      syncFocus();
    });
  };
  const syncFocus = () => {
    search.focused = focused && mode === "list";
    if (draft) draft.name.focused = focused && mode === "edit" && draft.cursor === 0;
    if (picker) picker.focused = focused && mode === "pick";
  };

  const renderList = (inner: number, height: number) => {
    const list = visible();
    selected = Math.max(0, Math.min(selected, list.length - 1));
    const confirm = keyText(keys, "tui.select.confirm");
    const cancel = keyText(keys, "tui.select.cancel");
    const footer = [
      ...(notice ? wrapTextWithAnsi(theme.fg("warning", safe(notice)), inner) : []),
      ...(mode === "confirm" && current()
        ? wrapTextWithAnsi(
            theme.fg(
              "warning",
              `Delete chain ${safe(current()!.name)}? Press y to delete, any other key keeps it.`,
            ),
            inner,
          )
        : hints(
            theme,
            [
              "type to search",
              "↑/↓ move",
              `${confirm} select`,
              "^E edit",
              "^N new",
              "^R reset",
              "^D delete",
              `${cancel} close`,
            ],
            inner,
          )),
    ];
    const prefix = [...search.render(inner), ""];
    const room = height - 2 - prefix.length - footer.length - 1;
    const body: string[] = [];
    if (!snapshot.views.length)
      body.push(theme.fg("muted", "No chains yet. Press ^N to create one."));
    else if (!list.length) body.push(theme.fg("muted", "No chains match the search."));
    const perRow = room >= list.length * 2 ? 2 : 1;
    const capacity = Math.max(1, Math.floor(room / perRow));
    const start = Math.max(
      0,
      Math.min(selected - Math.floor(capacity / 2), list.length - capacity),
    );
    for (const view of list.slice(start, start + capacity)) {
      const isCurrent = view === list[selected];
      const marks = stepMarks(view);
      const steps = view.targets
        .map((target, index) => {
          const text = safe(identity(target));
          const mark = marks[index];
          return mark === "active"
            ? theme.style(text, { fg: "accent", bold: true })
            : mark === "exhausted"
              ? theme.fg("error", text)
              : mark === "skipped" || mark === "done"
                ? theme.fg("dim", text)
                : theme.fg("muted", text);
        })
        .join(theme.fg("muted", " → "));
      const tags = badges(view)
        .map((badge) =>
          theme.fg(
            badge === "ready" || badge === "selected"
              ? "success"
              : badge.startsWith("retry") ||
                  badge.endsWith("skipped") ||
                  badge.startsWith("on step")
                ? "warning"
                : "error",
            `[${badge}]`,
          ),
        )
        .join(" ");
      const head = `${isCurrent ? theme.fg("accent", "❯") : " "} ${theme.style(safe(view.name), {
        fg: isCurrent ? "accent" : "text",
        bold: true,
      })} ${tags}`;
      if (perRow === 2)
        body.push(truncateToWidth(head, inner, "…"), truncateToWidth(`    ${steps}`, inner, "…"));
      else body.push(truncateToWidth(`${head} ${steps}`, inner, "…"));
    }
    while (body.length < room) body.push("");
    return [...prefix, ...body.slice(0, Math.max(room, 1)), "", ...footer];
  };

  const renderEditor = (inner: number, height: number) => {
    const d = draft!;
    const catalog = deps.catalog();
    const footer = [
      ...(notice ? wrapTextWithAnsi(theme.fg("warning", safe(notice)), inner) : []),
      ...hints(
        theme,
        d.cursor === 0
          ? [
              "type the name",
              "↓ steps",
              "^N add step",
              "^S save",
              `${keyText(keys, "tui.select.cancel")} back`,
            ]
          : [
              "↑/↓ move",
              `${keyText(keys, "tui.select.confirm")} replace`,
              "a/^N add",
              "x remove",
              "Shift+↑/↓ reorder",
              "^S save",
              `${keyText(keys, "tui.select.cancel")} back`,
            ],
        inner,
      ),
    ];
    const lines = [
      ...d.name.render(inner),
      theme.fg(
        d.cursor === 0 ? "accent" : "muted",
        `${d.steps.length} step${d.steps.length === 1 ? "" : "s"} · tried in order, 1 attempt + 2 retries each`,
      ),
      "",
    ];
    if (!d.steps.length)
      lines.push(theme.fg("muted", "No steps. Press ^N to add the first target."));
    const room = height - 2 - lines.length - footer.length - 1;
    const start = Math.max(0, Math.min(d.cursor - 1 - Math.floor(room / 2), d.steps.length - room));
    for (const [offset, step] of d.steps.slice(start, start + Math.max(1, room)).entries()) {
      const index = start + offset;
      const isCurrent = d.cursor === index + 1;
      const why = targetReason(catalog, step, d.steps.slice(0, index));
      lines.push(
        truncateToWidth(
          `${isCurrent ? theme.fg("accent", "❯") : " "} ${cell(theme.fg("muted", `${index + 1}.`), 3)} ${theme.fg(
            isCurrent ? "accent" : "text",
            safe(identity(step)),
          )}${why ? theme.fg("warning", `  ${safe(why)}`) : ""}`,
          inner,
          "…",
        ),
      );
    }
    while (lines.length < height - 2 - footer.length - 1) lines.push("");
    return [...lines, "", ...footer];
  };

  const component: Component & Focusable = {
    capturesViewportInput: true,
    get focused() {
      return focused;
    },
    set focused(value) {
      focused = value;
      syncFocus();
    },
    render(renderWidth) {
      width = Math.max(0, renderWidth);
      const height = Math.max(1, Math.floor(rows()));
      if (mode === "pick" && picker) return picker.render(width);
      const inner = Math.max(0, width - 4);
      if (width < 40 || height < 10)
        return frame(
          theme,
          "Model chains",
          [`Too small · widen the terminal · ${keyText(keys, "tui.select.cancel")} close`],
          width,
        );
      syncFocus();
      if (mode === "edit" && draft)
        return frame(
          theme,
          draft.original
            ? `Edit chain ${safe(draft.original)}${draft.dirty ? " *" : ""}`
            : "New chain",
          renderEditor(inner, height),
          width,
        );
      return frame(theme, "Model chains", renderList(inner, height), width);
    },
    handleInput(data) {
      if (mode === "pick" && picker) {
        picker.handleInput?.(data);
        return;
      }
      if (busy) return;
      if (mode === "confirm") {
        const view = current();
        mode = "list";
        notice = "";
        if (data === "y" && view) {
          if (view.name === active())
            notice = "Select another model before deleting the selected chain";
          else if (!deps.idle()) notice = "Deleting requires an idle session";
          else {
            const chains = { ...snapshot.config.chains };
            delete chains[view.name];
            run(async () => {
              await deps.save({ version: 1, chains }, snapshot.raw);
              await reload(`Deleted ${view.name}`);
            });
          }
        }
        syncFocus();
        requestRender();
        return;
      }
      if (mode === "edit" && draft) {
        handleEditor(draft, data);
        syncFocus();
        requestRender();
        return;
      }
      notice = "";
      const view = current();
      if (keys.matches(data, "tui.select.cancel")) {
        done();
        return;
      }
      if (keys.matches(data, "tui.select.up")) selected = Math.max(0, selected - 1);
      else if (keys.matches(data, "tui.select.down"))
        selected = Math.min(Math.max(0, visible().length - 1), selected + 1);
      else if (keys.matches(data, "tui.select.confirm")) {
        if (view) run(() => deps.activate(view.name), done);
      } else if (matchesKey(data, "ctrl+n")) edit();
      else if (matchesKey(data, "ctrl+e")) {
        if (view) edit(view);
      } else if (matchesKey(data, "ctrl+r")) {
        if (!view) return;
        if (!deps.idle()) notice = "Reset requires an idle session";
        else
          run(async () => {
            deps.reset(view.name);
            await reload(`Reset ${view.name} to its first available step`);
          });
      } else if (matchesKey(data, "ctrl+d")) {
        if (view) mode = "confirm";
      } else {
        const before = search.getValue();
        search.handleInput(data);
        if (search.getValue() !== before) selected = 0;
      }
      syncFocus();
      requestRender();
    },
    invalidate() {
      search.invalidate();
      draft?.name.invalidate();
      picker?.invalidate();
    },
  };

  function handleEditor(d: Draft, data: string) {
    if (keys.matches(data, "tui.select.cancel")) {
      if (d.dirty && !d.discard) {
        d.discard = true;
        notice = "Unsaved changes: press esc again to discard, or ^S to save";
        return;
      }
      draft = undefined;
      mode = "list";
      notice = "";
      return;
    }
    d.discard = false;
    notice = "";
    const step = d.cursor - 1;
    if (matchesKey(data, "ctrl+s")) save();
    else if (matchesKey(data, "ctrl+n") || (step >= 0 && data === "a")) openPicker(false);
    else if (matchesKey(data, "shift+up") || matchesKey(data, "shift+down")) {
      const to = step + (matchesKey(data, "shift+up") ? -1 : 1);
      if (step >= 0 && to >= 0 && to < d.steps.length) {
        [d.steps[step], d.steps[to]] = [d.steps[to], d.steps[step]];
        d.cursor = to + 1;
        d.dirty = true;
      }
    } else if (keys.matches(data, "tui.select.up")) d.cursor = Math.max(0, d.cursor - 1);
    else if (keys.matches(data, "tui.select.down"))
      d.cursor = Math.min(d.steps.length, d.cursor + 1);
    else if (step >= 0 && keys.matches(data, "tui.select.confirm")) openPicker(true);
    else if (step >= 0 && (data === "x" || matchesKey(data, "delete"))) {
      d.steps.splice(step, 1);
      d.cursor = Math.min(d.cursor, d.steps.length);
      d.dirty = true;
    } else if (d.cursor === 0) {
      if (keys.matches(data, "tui.select.confirm")) d.cursor = Math.min(1, d.steps.length);
      else {
        const before = d.name.getValue();
        d.name.handleInput(data);
        if (d.name.getValue() !== before) d.dirty = true;
      }
    }
  }
  return component;
}
