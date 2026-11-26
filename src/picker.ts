import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  Input,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";
import { filterCatalog, targetReason, type Catalog, type CatalogEntry } from "./catalog.ts";
import type { Target } from "./config.ts";
import {
  cell,
  effortLabel,
  frame,
  hints,
  keyText,
  modelIdentity,
  price,
  safe,
  tokenCount,
  type PanelKeys,
  type PanelTheme,
} from "./presentation.ts";

export interface PickerOptions {
  title: string;
  /** Targets already in the chain; picking one of them again is refused inline. */
  taken: readonly Target[];
  /** Effort to start the strip on when the model supports it (a replaced step's effort). */
  preferredEffort?: ModelThinkingLevel;
}

/**
 * Model and effort picker. The search input always has focus while browsing; Tab/Shift+Tab cycle
 * provider tabs; Enter opens an inline strip of the model's supported efforts and a second Enter
 * picks. Only the models and efforts Pi offers this session are listed (its model scope, or its
 * available models when no scope is set); other ineligible ones stay visible with their reason
 * but cannot be picked.
 */
export function createModelPicker(
  catalog: () => Catalog,
  options: PickerOptions,
  theme: PanelTheme,
  keys: PanelKeys,
  requestRender: () => void,
  done: (target: Target | undefined) => void,
  rows: () => number,
): Component & Focusable {
  const input = new Input({ prompt: "Search: ", placeholder: "name, provider or ID" });
  let snapshot = catalog();
  let provider = "";
  let selected = 0;
  let effort: ModelThinkingLevel | undefined;
  let notice = "";
  let focused = false;
  let width = 80;
  const matches = () => filterCatalog(snapshot, input.getValue(), provider);
  const listed = () => snapshot.entries.filter((entry) => entry.listed);
  const providers = () => ["", ...new Set(listed().map((entry) => entry.provider))];
  /** Efforts in the session scope; the rest are hidden, not offered with a reason. */
  const efforts = (entry: CatalogEntry) => entry.efforts.filter((item) => !item.reason);
  const target = (entry: CatalogEntry, value: ModelThinkingLevel): Target => ({
    provider: entry.provider,
    model: entry.model,
    effort: value,
  });
  const reason = (entry: CatalogEntry, value?: ModelThinkingLevel) =>
    value
      ? targetReason(snapshot, target(entry, value), options.taken)
      : (entry.reason ??
        (efforts(entry).some(
          ({ effort }) => !targetReason(snapshot, target(entry, effort), options.taken),
        )
          ? undefined
          : efforts(entry).length === 1
            ? targetReason(snapshot, target(entry, efforts(entry)[0].effort), options.taken)
            : "Every effort is already in this chain"));
  const openStrip = (entry: CatalogEntry) => {
    const allowed = efforts(entry).filter(({ effort }) => !reason(entry, effort));
    effort = (
      allowed.find((item) => item.effort === options.preferredEffort) ??
      allowed.find((item) => item.effort !== "off") ??
      allowed[0]
    )?.effort;
  };

  const component: Component & Focusable = {
    capturesViewportInput: true,
    get focused() {
      return focused;
    },
    set focused(value) {
      focused = value;
      input.focused = value;
    },
    render(renderWidth) {
      width = Math.max(0, renderWidth);
      const height = Math.max(1, Math.floor(rows()));
      const inner = Math.max(0, width - 4);
      const cancel = keyText(keys, "tui.select.cancel");
      const confirm = keyText(keys, "tui.select.confirm");
      if (width < 44 || height < 12)
        return frame(
          theme,
          "Pick a model",
          [`Too small · widen the terminal · ${cancel} back`],
          width,
        );
      const list = matches();
      selected = Math.max(0, Math.min(selected, list.length - 1));
      const entry = list[selected];
      if (!entry) effort = undefined;
      input.focused = focused;

      const tabs = providers();
      const active = Math.max(0, tabs.indexOf(provider));
      const tab = (index: number) =>
        index === active
          ? theme.style(` ${safe(tabs[index] || "All")} `, {
              fg: "accent",
              bold: true,
              inverse: true,
            })
          : theme.fg("muted", ` ${safe(tabs[index] || "All")} `);
      // Scroll the tabs so the active one stays visible.
      let first = 0;
      const span = (from: number) =>
        tabs
          .slice(from, active + 1)
          .reduce((sum, _, i) => sum + visibleWidth(tab(from + i)) + 1, 2);
      while (first < active && span(first) > inner) first++;
      const tabLine = truncateToWidth(
        (first ? theme.fg("muted", "… ") : "") +
          tabs
            .slice(first)
            .map((_, i) => tab(first + i))
            .join(" "),
        inner,
        "…",
      );

      const detail = entry
        ? [
            theme.fg("text", safe(entry.name)),
            ...[
              entry.contextWindow && `${tokenCount(entry.contextWindow)} context`,
              entry.maxTokens && `${tokenCount(entry.maxTokens)} output`,
              entry.cost && `${price(entry.cost)} per M tokens`,
              entry.vision && "vision",
              entry.reasoning && "reasoning",
              entry.virtual
                ? "virtual"
                : entry.auth
                  ? "auth configured"
                  : "no auth: skipped at runtime",
            ]
              .filter((part): part is string => typeof part === "string")
              .map((part) => theme.fg(part.startsWith("no auth") ? "warning" : "muted", part)),
          ].join(theme.fg("muted", " · "))
        : "";
      const strip =
        entry && effort
          ? wrapTextWithAnsi(
              `${theme.fg("muted", "Effort ")}${efforts(entry)
                .map(({ effort: value }) => {
                  const ok = !reason(entry, value);
                  return value === effort
                    ? theme.style(`[${effortLabel(value)}]`, {
                        fg: ok ? "accent" : "warning",
                        bold: true,
                      })
                    : theme.fg(ok ? "text" : "dim", effortLabel(value));
                })
                .join("  ")}`,
              inner,
            )
          : [];
      const why = entry ? (effort ? reason(entry, effort) : reason(entry)) : undefined;
      const status = notice
        ? wrapTextWithAnsi(theme.fg("warning", safe(notice)), inner)
        : why
          ? wrapTextWithAnsi(theme.fg("warning", `Not selectable: ${safe(why)}`), inner)
          : [];
      const footer = hints(
        theme,
        effort
          ? ["←/→ effort", `${confirm} pick`, `${cancel} back to models`]
          : [
              "type to search",
              "↑/↓ move",
              "Tab/Shift+Tab provider",
              `${confirm} choose effort`,
              `${cancel} cancel`,
            ],
        inner,
      );
      const prefix = [tabLine, ...input.render(inner), ""];
      const suffix = ["", truncateToWidth(detail, inner, "…"), ...strip, ...status, ...footer];
      const room = height - 2 - prefix.length - suffix.length;
      if (room < 1)
        return frame(
          theme,
          "Pick a model",
          [`Too small · widen the terminal · ${cancel} back`],
          width,
        );

      // Right-aligned columns sized over the whole snapshot so they stay put while searching.
      const auth = (item: CatalogEntry) =>
        item.virtual ? "virtual" : item.auth ? "auth ✓" : "no auth";
      const columns = [
        { key: "context", cell: (item: CatalogEntry) => tokenCount(item.contextWindow) },
        { key: "price", cell: (item: CatalogEntry) => price(item.cost) },
        { key: "vision", cell: (item: CatalogEntry) => (item.vision ? "vision" : "") },
        { key: "auth", cell: auth },
      ]
        .map((column) => ({
          ...column,
          width: Math.max(0, ...listed().map((item) => visibleWidth(column.cell(item)))),
        }))
        .filter((column) => column.width);
      const nameRoom = () => inner - 2 - columns.reduce((sum, column) => sum + column.width + 2, 0);
      // Narrow panes drop vision, then price, then context; auth status always stays.
      for (const key of ["vision", "price", "context"]) {
        if (nameRoom() >= 24) break;
        const index = columns.findIndex((column) => column.key === key);
        if (index >= 0) columns.splice(index, 1);
      }
      const start = Math.max(0, Math.min(selected - Math.floor(room / 2), list.length - room));
      const results = list.slice(start, start + room).map((item) => {
        const current = item === entry;
        const blocked = !!reason(item);
        return `${current ? theme.fg("accent", "❯") : " "} ${cell(
          modelIdentity(
            theme,
            item.provider,
            item.model,
            nameRoom(),
            current ? "accent" : blocked ? "dim" : "text",
          ),
          nameRoom(),
        )}${columns
          .map((column) => {
            const text = column.cell(item);
            const color = column.key === "auth" && text !== "auth ✓" ? "warning" : "muted";
            return `  ${" ".repeat(column.width - visibleWidth(text))}${theme.fg(blocked ? "dim" : color, text)}`;
          })
          .join("")}`;
      });
      if (!results.length)
        results.push(
          theme.fg(
            "muted",
            snapshot.error ??
              (listed().length
                ? "No matching models. Change the search or provider."
                : "No models available in this session."),
          ),
        );
      while (results.length < room) results.push("");
      return frame(theme, options.title, [...prefix, ...results, ...suffix], width);
    },
    handleInput(data) {
      if (keys.matches(data, "tui.select.cancel")) {
        // Escape peels the effort strip first, then leaves the picker without a change.
        if (effort) {
          effort = undefined;
          notice = "";
          requestRender();
        } else done(undefined);
        return;
      }
      const list = matches();
      const entry = list[selected];
      if (effort && entry && (matchesKey(data, "left") || matchesKey(data, "right"))) {
        // Ineligible efforts stay reachable so their reason can be read.
        const index = efforts(entry).findIndex((item) => item.effort === effort);
        const next = efforts(entry)[index + (matchesKey(data, "left") ? -1 : 1)];
        if (next) effort = next.effort;
        notice = "";
      } else if (effort && entry && keys.matches(data, "tui.select.confirm")) {
        const why = reason(entry, effort);
        if (why) notice = why;
        else {
          // Recheck against a fresh snapshot so auth or scope changes are not missed.
          snapshot = catalog();
          const fresh = snapshot.entries.find(
            (item) => item.provider === entry.provider && item.model === entry.model,
          );
          const rejection =
            fresh?.listed && efforts(fresh).some((item) => item.effort === effort)
              ? targetReason(snapshot, target(entry, effort), options.taken)
              : (snapshot.error ?? "No longer available in this session");
          if (!rejection) {
            done(target(entry, effort));
            return;
          }
          effort = undefined;
          notice = rejection;
        }
      } else {
        // Any other key closes the strip and applies to the list.
        effort = undefined;
        notice = "";
        if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
          const tabs = providers();
          const delta = matchesKey(data, "shift+tab") ? -1 : 1;
          provider =
            tabs[(Math.max(0, tabs.indexOf(provider)) + delta + tabs.length) % tabs.length];
          selected = 0;
        } else if (keys.matches(data, "tui.select.up")) selected = Math.max(0, selected - 1);
        else if (keys.matches(data, "tui.select.down"))
          selected = Math.min(Math.max(0, list.length - 1), selected + 1);
        else if (keys.matches(data, "tui.select.confirm")) {
          if (entry) {
            const why = reason(entry);
            if (why) notice = why;
            else openStrip(entry);
          }
        } else {
          const before = input.getValue();
          input.handleInput(data);
          if (input.getValue() !== before) selected = 0;
        }
      }
      requestRender();
    },
    invalidate() {
      input.invalidate();
    },
  };
  return component;
}
