import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  replaceControlCharacters,
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type KeybindingsManager,
} from "@earendil-works/pi-tui";

/** The theme subset the panels use; tests pass an identity theme. */
export type PanelTheme = Pick<Theme, "fg" | "style">;
export type PanelKeys = Pick<KeybindingsManager, "matches" | "getKeys">;
type Color = Parameters<Theme["fg"]>[0];

/** Strip control sequences from config- or catalogue-supplied text before drawing it. */
export const safe = (text: string) => replaceControlCharacters(text);

/** One glyph per effort, rising from off to max. */
const EFFORT_GLYPHS: Readonly<Record<ModelThinkingLevel, string>> = {
  off: "⦸",
  minimal: "◌",
  low: "◔",
  medium: "◑",
  high: "◕",
  xhigh: "●",
  max: "◉",
};
export const effortLabel = (effort: ModelThinkingLevel) => `${EFFORT_GLYPHS[effort]} ${effort}`;

/** Clip and pad to exactly `width` columns. */
export function cell(text: string, width: number): string {
  if (width <= 0) return "";
  const clipped = truncateToWidth(text, width, "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** Token counts as `1m`, `200k`, `8.2k`; unknown or non-positive counts are blank. */
export function tokenCount(tokens: number | undefined): string {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return "";
  const scaled = (scale: number) => {
    const value = tokens / scale;
    return value < 10 ? Number(value.toFixed(1)) : Math.round(value);
  };
  if (tokens >= 1e6 || scaled(1e3) >= 1000) return `${scaled(1e6)}m`;
  if (tokens >= 1e3) return `${scaled(1e3)}k`;
  return String(tokens);
}

/** `$input/output` per million tokens; all-zero cost is `$0` because zero may mean unknown. */
export function price(cost: { input: number; output: number } | undefined): string {
  if (!cost) return "";
  const amount = (value: number) => String(Number(value.toFixed(3)));
  return cost.input === 0 && cost.output === 0
    ? "$0"
    : `$${amount(cost.input)}/${amount(cost.output)}`;
}

/** Muted `provider/` and a bright id; the provider is clipped first so the id stays visible. */
export function modelIdentity(
  theme: Pick<PanelTheme, "fg">,
  provider: string,
  id: string,
  width: number,
  idColor: Color = "text",
): string {
  const clip = (text: string, room: number) =>
    visibleWidth(text) <= room ? text : room < 1 ? "" : `${sliceByColumn(text, 0, room - 1)}…`;
  if (width < 3) return theme.fg(idColor, clip(id, width));
  const providerRoom = Math.max(1, width - visibleWidth(id) - 1);
  return (
    theme.fg("muted", `${clip(safe(provider), providerRoom)}/`) +
    theme.fg(idColor, clip(safe(id), width - providerRoom - 1))
  );
}

const keyGlyphs: Readonly<Record<string, string>> = { enter: "⏎", escape: "esc" };
/** A binding's first key for hints, with Enter shown as a glyph. */
export function keyText(keys: PanelKeys, action: Parameters<PanelKeys["getKeys"]>[0]): string {
  const [key] = keys.getKeys(action);
  return key ? (keyGlyphs[key] ?? key) : "";
}

/** Wrap muted hint text to the inner width. */
export function hints(theme: PanelTheme, parts: string[], width: number): string[] {
  return wrapTextWithAnsi(parts.join(" · "), Math.max(1, width)).map((line) =>
    theme.fg("muted", line),
  );
}

/**
 * Draw a rounded frame around body lines: `title` sits in the top border and every body line is
 * clipped and padded to the inner width, so the frame never overflows `width`.
 */
export function frame(theme: PanelTheme, title: string, body: string[], width: number): string[] {
  if (width < 4) return body.map((line) => cell(line, width));
  const inner = width - 4;
  const label = truncateToWidth(` ${title} `, Math.max(0, width - 4), "…");
  const top =
    theme.fg("border", "╭─") +
    theme.style(label, { fg: "accent", bold: true }) +
    theme.fg("border", `${"─".repeat(Math.max(0, width - 3 - visibleWidth(label)))}╮`);
  const side = theme.fg("border", "│");
  return [
    top,
    ...body.map((line) => `${side} ${cell(line, inner)} ${side}`),
    theme.fg("border", `╰${"─".repeat(width - 2)}╯`),
  ];
}
