/**
 * Turn policy (OMH-shaped, Guild-sized).
 * Same seat model. Lane only changes effort. Catalog lists at most a few
 * matching skills. Family calibration is a short anti-habit paragraph.
 * Stall wrap is evidence, not a wall clock.
 */
import type { SkillRef, ToolTrace } from "./tools.ts";

export type TurnLane = "quick" | "default" | "deep";

export const TURN_SKILL_CAP = 3;
const STALL_WINDOW = 3;

export function scoreTurnLane(asked: string): TurnLane {
  const text = String(asked || "").trim();
  if (!text) return "quick";
  const lower = text.toLowerCase();
  if (
    /找出所有|每一個檔|每个文件|every file|all references|exhaustive|refactor (the )?arch|architecture|發版|release cut|全倉/i.test(
      text,
    ) ||
    (text.length > 800 && /檔|file|repo|src\//i.test(text))
  ) {
    return "deep";
  }
  if (
    text.length <= 80 &&
    /^(ok|okay|thanks|thank you|got it|yes|no|yep|nah|好|收到|嗯|謝謝|谢谢|可以|繼續|继续|重問)\.?$/i.test(
      text,
    )
  ) {
    return "quick";
  }
  if (
    text.length <= 120 &&
    !/[./\\]|\b(src|test|fix|bug|git|deploy|skill|spawn)\b/i.test(lower) &&
    !/@[a-z]/.test(lower)
  ) {
    return "quick";
  }
  return "default";
}

export function effortForLane(lane: TurnLane): "low" | "medium" | "high" {
  if (lane === "quick") return "low";
  if (lane === "deep") return "high";
  return "medium";
}

function skillKey(item: SkillRef): string {
  return (item.slug || item.name || "").trim().toLowerCase();
}

function tokensOf(text: string): string[] {
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (const word of lower.match(/[a-z][a-z0-9-]{1,}|[0-9]{2,}/g) || []) {
    out.add(word);
  }
  for (const run of lower.match(/[\u3400-\u9fff]+/g) || []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

function skillScore(item: SkillRef, toks: string[]): number {
  const hay = `${item.name} ${item.slug || ""} ${item.description || ""}`.toLowerCase();
  let n = 0;
  for (const tok of toks) {
    if (hay.includes(tok)) n += tok.length > 3 ? 2 : 1;
  }
  return n;
}

/** Keep /slug hits, then the best token matches, at most `cap`. Empty ask keeps the full list. */
export function selectTurnSkills(
  skills: SkillRef[],
  asked: string,
  cap = TURN_SKILL_CAP,
): SkillRef[] {
  if (!skills.length) return [];
  const text = String(asked || "").trim();
  if (!text) return skills;
  const named = new Set(
    [...text.matchAll(/(?:^|\s)\/([a-z0-9][a-z0-9_-]{1,40})/gi)].map((m) =>
      m[1].toLowerCase(),
    ),
  );
  const kept: SkillRef[] = [];
  const seen = new Set<string>();
  for (const item of skills) {
    const key = skillKey(item);
    if (!named.has(key) && !named.has(item.name.toLowerCase())) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  const toks = tokensOf(text);
  const ranked = skills
    .filter((item) => !seen.has(skillKey(item)))
    .map((item) => ({ item, n: skillScore(item, toks) }))
    .filter((row) => row.n > 0)
    .sort((a, b) => b.n - a.n || skillKey(a.item).localeCompare(skillKey(b.item)));
  for (const row of ranked) {
    if (kept.length >= cap) break;
    const key = skillKey(row.item);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row.item);
  }
  return kept.slice(0, cap);
}

function familyOf(providerId: string, modelId: string): string {
  const p = String(providerId || "").toLowerCase();
  const m = String(modelId || "").toLowerCase();
  const hay = `${p} ${m}`;
  if (/commandcode|command-code/.test(hay)) return "commandcode";
  if (/antigravity|\bagy\b|gemini|google/.test(hay)) return "gemini";
  if (/claude|anthropic/.test(hay)) return "claude";
  if (/grok|\bxai\b/.test(hay)) return "grok";
  if (/\bgpt\b|openai|codex/.test(hay)) return "gpt";
  if (/kimi/.test(hay)) return "kimi";
  if (/\bglm\b|z-ai/.test(hay)) return "glm";
  if (/qwen/.test(hay)) return "qwen";
  if (/deepseek/.test(hay)) return "deepseek";
  return "unknown";
}

const CALIBRATION: Record<string, string> = {
  grok: "Grok: treat tool output as the only evidence. Do not narrate a plan and stop. If a tool errors, change the approach once; do not repeat the same call.",
  claude:
    "Claude: the checklist in this prompt is complete. Do not add process theater. Call tools or answer. A claim without tool output is unfinished work.",
  gemini:
    "Gemini: a claim without tool output is not evidence. Do not invent file contents. If agy/tools already ran, use that result instead of re-doing the same step.",
  gpt: "GPT: echo the goal in one line, then act. Do not keep sampling on a task that already failed the same way twice.",
  kimi: "Kimi: prefer short tool batches. Do not dump the whole tree into context when a targeted read will do.",
  glm: "GLM: skip preamble. Tools first when the question is about this machine. Stop when the directive is done.",
  qwen: "Qwen: do not emit thinking tags or chain-of-thought wrappers. Answer or call a tool.",
  deepseek:
    "DeepSeek: version and thinking mode are already set by Guild. Do not toggle them in prose. Use tools, then a final reply.",
  commandcode:
    "Command Code: Guild still runs tools. Do not ask the user to paste a command. One clear answer after tools.",
  unknown:
    "Use tools for machine facts. Do not recap the thread. If the last two tool calls failed the same way, write a final reply with what is missing instead of looping.",
};

export function calibrationFor(providerId: string, modelId: string): string {
  return CALIBRATION[familyOf(providerId, modelId)] ?? CALIBRATION.unknown;
}

export const PARALLEL_HINT =
  "Independent slices: several spawn or read/list calls in one round, disjoint file paths, no two children on the same file. A child exit 0 is reported done, not verified — read the evidence before you claim finished or @handle the next seat.";

export function toolSignature(trace: ToolTrace): string {
  let args = "";
  try {
    args = JSON.stringify(trace.args ?? {});
  } catch {
    args = "";
  }
  return `${trace.name}:${args}`;
}

/** Three errors in a row, or the same call three times: wrap. Not a wall clock. */
export function stalledToolLoop(traces: ToolTrace[]): boolean {
  if (traces.length < STALL_WINDOW) return false;
  const last = traces.slice(-STALL_WINDOW);
  if (last.every((row) => row.isError)) return true;
  const sig = last.map(toolSignature);
  return Boolean(sig[0]) && sig[0] === sig[1] && sig[1] === sig[2];
}
