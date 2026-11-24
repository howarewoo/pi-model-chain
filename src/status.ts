import { identity, type Target } from "./config.ts";

export const RETRIES = 2;

/** Branch-local routing state for one chain, as persisted in `model-chain.state.v1` entries. */
export interface ChainState {
  index: number;
  failures: number;
  exhausted: boolean;
  skipped: { target: string; reason: string }[];
}
export interface ChainView {
  name: string;
  targets: readonly Target[];
  /** Undefined until the chain routes a request on this branch. */
  state?: ChainState;
  /** The chain's targets changed since its state was saved; /chain-reset is required. */
  changed?: boolean;
  /** The session currently has `chain/<name>` selected. */
  active?: boolean;
}

export type StepMark = "active" | "done" | "skipped" | "pending" | "exhausted";
/** How each step of a chain reads on this branch. */
export function stepMarks(view: ChainView): StepMark[] {
  const state = view.changed ? undefined : view.state;
  const skipped = new Set(state?.skipped.map((item) => item.target));
  return view.targets.map((target, index) => {
    if (!state) return index === 0 ? "active" : "pending";
    if (index === state.index) return state.exhausted ? "exhausted" : "active";
    if (skipped.has(identity(target))) return "skipped";
    return index < state.index ? "done" : "pending";
  });
}

/** Short badges for list rows and status headers. */
export function badges(view: ChainView): string[] {
  const state = view.changed ? undefined : view.state;
  return [
    ...(view.active ? ["selected"] : []),
    ...(view.changed ? ["changed · reset required"] : []),
    ...(state?.exhausted ? ["exhausted · reset required"] : []),
    ...(state && !state.exhausted && state.failures
      ? [`retry ${Math.min(state.failures, RETRIES)}/${RETRIES}`]
      : []),
    ...(state?.skipped.length ? [`${state.skipped.length} skipped`] : []),
    ...(state && !state.exhausted && state.index > 0 ? [`on step ${state.index + 1}`] : []),
    ...(!view.changed && (!state || (!state.exhausted && !state.failures && !state.index))
      ? ["ready"]
      : []),
  ];
}

const glyph: Record<StepMark, string> = {
  active: "▶",
  done: "✗",
  skipped: "↷",
  pending: "·",
  exhausted: "■",
};

/** Compact footer status showing the active target model and chain state. */
export function formatFooterStatus(view: ChainView): string {
  if (view.changed) return `Chain-${view.name} (changed · reset required)`;
  const index = view.state?.index ?? 0;
  const target = view.targets[index] ?? view.targets[0];
  if (!target) return `Chain-${view.name}`;
  const base = `${target.provider}/${target.model} Chain-${view.name} ${target.effort}`;
  if (view.state?.exhausted) return `${base} (exhausted)`;
  const parts: string[] = [];
  if (view.state && view.state.index > 0)
    parts.push(`${view.state.index + 1}/${view.targets.length}`);
  if (view.state && view.state.failures > 0)
    parts.push(`retry ${Math.min(view.state.failures, RETRIES)}/${RETRIES}`);
  return parts.length ? `${base} (${parts.join(" · ")})` : base;
}

/** Plain, readable status text shared by the UI notification and headless output. */
export function formatStatus(input: {
  view?: ChainView;
  chains: readonly string[];
  problem?: string;
  warning?: string;
}): string[] {
  const { view, chains, problem, warning } = input;
  const lines: string[] = [];
  if (!view) {
    lines.push(
      chains.length
        ? `No chain selected. Configured: ${chains.map((name) => `chain/${name}`).join(", ")}.`
        : "No chains configured. Open /chain to create one.",
      "Select a chain in /model or /chain.",
    );
  } else {
    lines.push(`Chain ${view.name} (chain/${view.name}) · ${badges(view).join(" · ")}`);
    const marks = stepMarks(view);
    view.targets.forEach((target, index) => {
      const mark = marks[index];
      const note =
        mark === "active" && view.state && !view.changed && view.state.failures
          ? `  active · ${Math.min(view.state.failures, RETRIES)} of ${RETRIES} retries used`
          : mark === "active"
            ? "  active"
            : mark === "exhausted"
              ? "  exhausted"
              : mark === "done"
                ? "  failed over"
                : mark === "skipped"
                  ? "  skipped"
                  : "";
      lines.push(`  ${glyph[mark]} ${index + 1}. ${identity(target)}${note}`);
    });
    for (const item of view.changed ? [] : (view.state?.skipped ?? []))
      lines.push(`  Skipped ${item.target}: ${item.reason}`);
    lines.push(
      `Each target gets 1 attempt + ${RETRIES} retries for eligible failures. Reset with /chain-reset when idle.`,
    );
  }
  if (problem) lines.push(`Problem: ${problem}`);
  if (warning) lines.push(`Warning: ${warning}`);
  lines.push(
    "Note: failed requests can incur costs, and their usage may be unknown. Switching targets can lose caches or trigger compaction.",
  );
  return lines;
}
