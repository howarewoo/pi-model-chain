// Regenerate the README illustration: node scripts/render-readme-svg.ts
// Renders the production /chain manager and model picker with synthetic data; no provider,
// session, credentials or terminal are used.
import { writeFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import {
  KeybindingsManager,
  parseColor,
  styleText,
  TUI_KEYBINDINGS,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { Catalog } from "../src/catalog.ts";
import type { Config } from "../src/config.ts";
import { createChainManager } from "../src/manager.ts";
import { createModelPicker } from "../src/picker.ts";
import type { PanelTheme } from "../src/presentation.ts";

const colors: Record<string, string> = {
  accent: "#7fc8d9",
  border: "#5f7f9f",
  muted: "#8a8a8a",
  dim: "#5e5e5e",
  text: "#d8d8d8",
  warning: "#e5c07b",
  error: "#e27878",
  success: "#98c379",
};
const theme: PanelTheme = {
  fg: (color, text) =>
    styleText(text, { fg: parseColor(colors[color] ?? colors.text) }, "truecolor"),
  style: (text, options) =>
    styleText(
      text,
      {
        ...options,
        fg:
          typeof options.fg === "string"
            ? parseColor(colors[options.fg] ?? colors.text)
            : options.fg,
        bg: undefined,
      },
      "truecolor",
    ),
};
const keys = new KeybindingsManager(TUI_KEYBINDINGS);

const efforts = (...values: Catalog["entries"][number]["efforts"][number]["effort"][]) =>
  values.map((effort) => ({ effort }));
const model = (
  provider: string,
  id: string,
  name: string,
  extra: Partial<Catalog["entries"][number]>,
): Catalog["entries"][number] => ({
  provider,
  model: id,
  name,
  providerLabel: provider,
  virtual: false,
  auth: true,
  efforts: efforts("off", "low", "medium", "high"),
  contextWindow: 200_000,
  maxTokens: 64_000,
  vision: true,
  reasoning: true,
  ...extra,
});
const catalog: Catalog = {
  entries: [
    model("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5", {
      cost: { input: 3, output: 15 },
    }),
    model("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5", { cost: { input: 1, output: 5 } }),
    model("openai", "gpt-5", "GPT-5", {
      contextWindow: 400_000,
      maxTokens: 128_000,
      cost: { input: 1.25, output: 10 },
      efforts: efforts("minimal", "low", "medium", "high"),
    }),
    model("openai", "gpt-4.1", "GPT-4.1", {
      contextWindow: 1_047_576,
      maxTokens: 32_768,
      cost: { input: 2, output: 8 },
      efforts: efforts("off"),
      reasoning: false,
    }),
    model("google", "gemini-2.5-pro", "Gemini 2.5 Pro", {
      contextWindow: 1_048_576,
      cost: { input: 1.25, output: 10 },
      auth: false,
    }),
    model("openrouter", "deepseek-r1", "DeepSeek R1", {
      contextWindow: 128_000,
      cost: { input: 0.55, output: 2.19 },
      vision: false,
    }),
  ],
};
const config: Config = {
  version: 1,
  chains: {
    work: [
      { provider: "anthropic", model: "claude-sonnet-4-5", effort: "high" },
      { provider: "openai", model: "gpt-5", effort: "medium" },
      { provider: "google", model: "gemini-2.5-pro", effort: "high" },
    ],
    cheap: [
      { provider: "anthropic", model: "claude-haiku-4-5", effort: "low" },
      { provider: "openrouter", model: "deepseek-r1", effort: "off" },
    ],
    review: [
      { provider: "openai", model: "gpt-4.1", effort: "off" },
      { provider: "anthropic", model: "claude-sonnet-4-5", effort: "medium" },
    ],
  },
};
const views = [
  {
    name: "work",
    targets: config.chains.work,
    active: true,
    state: { index: 1, failures: 1, exhausted: false, skipped: [] },
  },
  { name: "cheap", targets: config.chains.cheap },
  {
    name: "review",
    targets: config.chains.review,
    state: { index: 1, failures: 3, exhausted: true, skipped: [] },
  },
];
const manager = createChainManager(
  {
    read: async () => ({ config, views }),
    catalog: () => catalog,
    idle: () => true,
    save: async () => {},
    activate: async () => {},
    reset: () => {},
  },
  { config, views },
  theme,
  keys,
  () => {},
  () => {},
  () => 14,
);
const picker = createModelPicker(
  () => catalog,
  { title: "Add a step to work", taken: config.chains.work, preferredEffort: "medium" },
  theme,
  keys,
  () => {},
  () => {},
  () => 17,
);
for (const key of ["\x1b[B", "\r"]) picker.handleInput?.(key);
const lines = [...manager.render(100), "", ...picker.render(100)];

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const background = "#1a1b1e";
const cellWidth = 8.4;
const lineHeight = 20;
const width = Math.ceil(40 + 100 * cellWidth);
const height = 52 + lines.length * lineHeight + 20;
const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
  '<title id="title">Model chain manager and model picker</title>',
  '<desc id="desc">The /chain overlay listing three chains with status badges and ordered steps, above the model picker with provider tabs, aligned context, cost, vision and auth columns, and the inline effort strip. Rendered from the production components with synthetic data; not a terminal screenshot.</desc>',
  `<rect width="100%" height="100%" rx="8" fill="${background}"/>`,
  `<text x="20" y="30" fill="#9a9a9a" font-family="Menlo, monospace" font-size="12">ILLUSTRATION · /chain manager and model picker · synthetic data</text>`,
];
for (const [row, line] of lines.entries()) {
  let column = 0;
  let fg = colors.text;
  let bold = false;
  let inverse = false;
  // Colors come from the renderer's SGR sequences; drop cursor markers and other APC strings.
  // oxlint-disable-next-line no-control-regex
  const clean = line.replaceAll(/\x1b_[^\x07]*\x07/g, "");
  // oxlint-disable-next-line no-control-regex
  for (const part of clean.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith("\x1b[")) {
      const codes = part.slice(2, -1).split(";").map(Number);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code === 0) [fg, bold, inverse] = [colors.text, false, false];
        else if (code === 1) bold = true;
        else if (code === 22) bold = false;
        else if (code === 7) inverse = true;
        else if (code === 27) inverse = false;
        else if (code === 39) fg = colors.text;
        else if (code === 38 && codes[i + 1] === 2) {
          fg = `rgb(${codes.slice(i + 2, i + 5).join(",")})`;
          i += 4;
        }
      }
      continue;
    }
    const text = stripVTControlCharacters(part);
    const columns = visibleWidth(text);
    if (!columns) continue;
    const x = 20 + column * cellWidth;
    const y = 52 + row * lineHeight;
    const length = columns * cellWidth;
    if (inverse)
      svg.push(`<rect x="${x}" y="${y}" width="${length}" height="${lineHeight}" fill="${fg}"/>`);
    svg.push(
      `<text x="${x}" y="${y + 15}" xml:space="preserve" fill="${inverse ? background : fg}" font-family="Menlo, monospace" font-size="14"${bold ? ' font-weight="bold"' : ""} textLength="${length}" lengthAdjust="spacingAndGlyphs">${escape(text)}</text>`,
    );
    column += columns;
  }
}
svg.push("</svg>\n");
writeFileSync(new URL("../docs/images/chain-manager.svg", import.meta.url), svg.join(""));
console.log(`Wrote docs/images/chain-manager.svg (${lines.length} lines)`);
