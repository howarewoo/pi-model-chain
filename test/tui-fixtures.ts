import { stripVTControlCharacters } from "node:util";
import type { KeyId } from "@earendil-works/pi-tui";
import type { Catalog } from "../src/catalog.ts";

// Plain theme and key map for deterministic component tests; no terminal or provider.
export const theme = {
  fg: (_color: string, text: string) => text,
  style: (text: string) => text,
};
const bindings: Record<string, string> = {
  "tui.select.cancel": "\x1b",
  "tui.select.confirm": "\r",
  "tui.select.up": "\x1b[A",
  "tui.select.down": "\x1b[B",
};
export const keys = {
  matches: (data: string, action: string) => data === bindings[action],
  getKeys: (action: string): KeyId[] =>
    action === "tui.select.confirm" ? ["enter"] : action === "tui.select.cancel" ? ["escape"] : [],
};
export const KEY = {
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  enter: "\r",
  esc: "\x1b",
  tab: "\t",
  shiftTab: "\x1b[Z",
  shiftUp: "\x1b[1;2A",
  shiftDown: "\x1b[1;2B",
  ctrl: (letter: string) => String.fromCharCode(letter.charCodeAt(0) - 96),
};
export const plain = (lines: readonly string[]) =>
  lines.map((line) => stripVTControlCharacters(line.replaceAll(/\x1b_[^\x07]*\x07/g, "")));

const efforts = (...values: string[]) =>
  values.map((effort) => ({ effort })) as Catalog["entries"][number]["efforts"];
export const catalog: Catalog = {
  entries: [
    {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      providerLabel: "Anthropic",
      virtual: false,
      listed: true,
      auth: true,
      efforts: efforts("off", "low", "medium", "high"),
      contextWindow: 200_000,
      maxTokens: 64_000,
      cost: { input: 3, output: 15 },
      vision: true,
      reasoning: true,
    },
    {
      provider: "openai",
      model: "gpt-4.1",
      name: "GPT-4.1",
      providerLabel: "OpenAI",
      virtual: false,
      listed: true,
      auth: false,
      efforts: efforts("off"),
      contextWindow: 1_047_576,
      maxTokens: 32_768,
      cost: { input: 2, output: 8 },
      vision: true,
      reasoning: false,
    },
    {
      provider: "openai",
      model: "o4-mini",
      name: "o4-mini",
      providerLabel: "OpenAI",
      virtual: false,
      listed: true,
      auth: true,
      efforts: [
        { effort: "low" },
        { effort: "medium" },
        { effort: "high", reason: "Outside this session's model/effort scope" },
      ],
      contextWindow: 200_000,
      maxTokens: 100_000,
      cost: { input: 1.1, output: 4.4 },
      vision: false,
      reasoning: true,
    },
    {
      provider: "google",
      model: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      providerLabel: "Google",
      virtual: false,
      listed: false,
      auth: true,
      efforts: [{ effort: "high", reason: "Outside this session's model/effort scope" }],
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      cost: { input: 1.25, output: 10 },
      vision: true,
      reasoning: true,
    },
    {
      provider: "chain",
      model: "work",
      name: "Chain: work",
      providerLabel: "chain",
      virtual: true,
      listed: true,
      auth: false,
      efforts: [],
      vision: true,
      reasoning: false,
      reason: "Virtual model; chains need physical targets",
    },
  ],
};

/** The shared catalogue plus a listed model with a long provider and model ID. */
export const longCatalog: Catalog = {
  entries: [
    ...catalog.entries,
    {
      provider: "amazon-bedrock",
      model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      name: "Claude Sonnet 4.5 (Bedrock US)",
      providerLabel: "Amazon Bedrock",
      virtual: false,
      listed: true,
      auth: true,
      efforts: efforts("off", "high"),
      contextWindow: 200_000,
      maxTokens: 64_000,
      cost: { input: 3.3, output: 16.5 },
      vision: true,
      reasoning: true,
    },
  ],
};
