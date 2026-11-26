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
  panel,
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

/** Frames this wide or wider show the provider column; narrower ones show a provider line. */
export const PROVIDER_COLUMN_WIDTH = 72;

/**
 * Model and effort picker. A provider column ("All" first) sits left of the search box and model
 * list; ←/→ move between them and ↑/↓ move within the focused one. Typing always edits the
 * search. Enter on a model opens an inline strip of its supported efforts and a second Enter
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
  let column: "providers" | "models" = "models";
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
  const moveProvider = (delta: number) => {
    const list = providers();
    const index = Math.max(0, list.indexOf(provider));
    provider = list[Math.max(0, Math.min(list.length - 1, index + delta))];
    selected = 0;
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
      const tooSmall = () =>
        frame(theme, options.title, [`Too small · widen the terminal · ${cancel} back`], width);
      if (width < 44 || height < 12) return tooSmall();
      const list = matches();
      selected = Math.max(0, Math.min(selected, list.length - 1));
      const entry = list[selected];
      if (!entry) effort = undefined;
      input.focused = focused;
      const onProviders = column === "providers" && !effort;

      // Provider column: "All" first, then each provider with its matching-model count.
      const names = providers();
      if (!names.includes(provider)) provider = "";
      const query = input.getValue();
      const count = (name: string) => filterCatalog(snapshot, query, name).length;
      const label = (name: string) => safe(name || "All");
      const split = width >= PROVIDER_COLUMN_WIDTH;
      const columnWidth = split
        ? Math.min(
            24,
            Math.floor(inner / 4),
            Math.max(
              ...names.map(
                (name) => visibleWidth(label(name)) + 2 + String(count(name)).length + 1,
              ),
            ),
          )
        : 0;
      const right = split ? inner - columnWidth - 3 : inner;
      const marker = (current: boolean, active: boolean) =>
        current ? (active ? theme.fg("accent", "❯") : theme.fg("muted", "›")) : " ";
      const providerRow = (name: string) => {
        const current = name === provider;
        const matched = count(name);
        const tally = theme.fg(matched ? "muted" : "dim", String(matched));
        return `${marker(current, onProviders)} ${cell(
          theme.style(label(name), {
            fg: current && onProviders ? "accent" : current ? "text" : matched ? "muted" : "dim",
            bold: current,
          }),
          columnWidth - 3 - visibleWidth(tally),
        )} ${tally}`;
      };
      const providerLine = () => {
        const index = Math.max(0, names.indexOf(provider));
        const matched = count(provider);
        const name = theme.style(label(provider), {
          fg: onProviders ? "accent" : "text",
          bold: true,
        });
        const tally = `· ${matched} model${matched === 1 ? "" : "s"} · ${index + 1}/${names.length}`;
        return `${marker(true, onProviders)} ${theme.fg("muted", "Provider")} ${name} ${theme.fg("muted", tally)}`;
      };

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
      const footer = [
        ...(detail ? [truncateToWidth(detail, inner, "…")] : []),
        ...strip,
        ...status,
        ...hints(
          theme,
          effort
            ? ["←/→ effort", `${confirm} pick`, `${cancel} back to models`]
            : onProviders
              ? ["↑/↓ provider", `→/${confirm} models`, "type to search", `${cancel} cancel`]
              : [
                  "type to search",
                  "↑/↓ move",
                  "← providers",
                  `${confirm} choose effort`,
                  `${cancel} cancel`,
                ],
          inner,
        ),
      ];
      const prefix = [...(split ? [] : [providerLine()]), ...input.render(right), ""];
      const body = height - 3 - footer.length;
      const room = body - prefix.length;
      if (room < 1) return tooSmall();

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
      const nameRoom = () => right - 2 - columns.reduce((sum, column) => sum + column.width + 2, 0);
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
        const color = current && !onProviders ? "accent" : blocked ? "dim" : "text";
        // A selected provider is implied, so its rows give the whole width to the model ID.
        const name = provider
          ? theme.fg(color, safe(item.model))
          : modelIdentity(theme, item.provider, item.model, nameRoom(), color);
        return `${marker(current, !onProviders)} ${cell(name, nameRoom())}${columns
          .map((column) => {
            const text = column.cell(item);
            const color = column.key === "auth" && text !== "auth ✓" ? "warning" : "muted";
            return `  ${" ".repeat(column.width - visibleWidth(text))}${theme.fg(blocked ? "dim" : color, text)}`;
          })
          .join("")}`;
      });
      if (!results.length)
        results.push(
          ...wrapTextWithAnsi(
            theme.fg(
              "muted",
              snapshot.error ??
                (listed().length
                  ? provider && count("")
                    ? `No ${safe(provider)} models match. ← to pick another provider, or change the search.`
                    : "No matching models. Change the search."
                  : "No models available in this session."),
            ),
            right,
          ),
        );
      const models = [...prefix, ...results];
      if (!split) return panel(theme, options.title, { list: models, footer }, width, height);
      const pStart = Math.max(
        0,
        Math.min(names.indexOf(provider) - Math.floor((body - 2) / 2), names.length - (body - 2)),
      );
      const left = [
        theme.fg("muted", "Providers"),
        "",
        ...names.slice(pStart, pStart + body - 2).map(providerRow),
      ];
      return panel(
        theme,
        options.title,
        { list: left, detail: models, footer },
        width,
        height,
        columnWidth,
      );
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
        // Any other key closes the strip and applies to the focused column.
        effort = undefined;
        notice = "";
        const up = keys.matches(data, "tui.select.up");
        const down = keys.matches(data, "tui.select.down");
        if (matchesKey(data, "left")) column = "providers";
        else if (matchesKey(data, "right")) column = "models";
        else if (column === "providers" && (up || down)) moveProvider(up ? -1 : 1);
        else if (column === "providers" && keys.matches(data, "tui.select.confirm"))
          column = "models";
        else if (up) selected = Math.max(0, selected - 1);
        else if (down) selected = Math.min(Math.max(0, list.length - 1), selected + 1);
        else if (keys.matches(data, "tui.select.confirm")) {
          if (entry) {
            const why = reason(entry);
            if (why) notice = why;
            else openStrip(entry);
          }
        } else {
          // Typing always edits the search, which belongs to the model list.
          const before = input.getValue();
          input.handleInput(data);
          if (input.getValue() !== before) {
            selected = 0;
            column = "models";
          }
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
