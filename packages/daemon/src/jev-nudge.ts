import type { ToolContext } from "./tools.ts";

const THRESHOLD = 0.5;
const MAX_NUDGES = 8;
const TIMEOUT_MS = 8_000;
const MAX_TEXT = 2_000;

export const NUDGE_REASON =
  "Gentle nudge: the user’s request still has unfinished work you can advance right now. Pick up the next useful step and keep going. If you are actually done, or the next step needs the user’s permission, a decision, or information only they have, say so in one line and stop.";

const NUDGE_INSTRUCTIONS = [
  "Would a gentle nudge help the agent advance useful work within the user’s existing request right now?",
  "Consider unfinished work, including requests carried forward from earlier turns (`user_requests`). Answering the latest message doesn’t necessarily finish the request.",
  "If the work is complete, the user is still choosing a direction, or progress requires permission, information, or an external event, don’t nudge.",
  "If there was a previous nudge (`previous_nudges`), consider what happened afterward. Further useful progress can justify another nudge; repeating the same promise or an already-explained blocker does not.",
].join("\n\n");

const WAITING_INSTRUCTIONS =
  "Is the agent stopped because the next step needs something only the user or the outside world can supply: a permission, a decision between directions, missing information, or an external event?";

const PROGRESS_INSTRUCTIONS =
  "The last entry in `previous_nudges` holds `assistant_text_at_nudge`, what the agent said when it was nudged, and `tool_calls_after`, how many tools it ran since. Compare that with `latest_assistant_message` and `recent_tool_calls`: has the agent moved on to further useful work, rather than repeating the same promise or the same already-explained blocker?";

export type NudgeAnswers = {
  nudge: number;
  waiting: number;
  progress?: number;
};

export type NudgeMark = {
  text: string;
  toolsAfter: number;
};

function clip(text: string): string {
  const raw = text.trim();
  if (raw.length <= MAX_TEXT) return raw;
  return `${raw.slice(0, MAX_TEXT)}…`;
}

function unit(value: unknown): number | null {
  if (typeof value === "number" && value >= 0 && value <= 1) return value;
  if (!value || typeof value !== "object") return null;
  const noul = (value as { noul?: unknown }).noul;
  if (typeof noul !== "number" || noul < 0 || noul > 1) return null;
  return noul;
}

function answersFromRecord(rec: Record<string, unknown>): NudgeAnswers | null {
  const nudge = unit(rec.nudge);
  const waiting = unit(rec.waiting);
  if (nudge == null || waiting == null) return null;
  const progress = rec.progress == null ? undefined : unit(rec.progress);
  if (rec.progress != null && progress == null) return null;
  return { nudge, waiting, ...(progress == null ? {} : { progress }) };
}

export function parseNudgeAnswers(raw: unknown): NudgeAnswers | null {
  if (typeof raw === "string") {
    const fenced = raw.match(/\{[\s\S]*\}/);
    if (!fenced) return null;
    try {
      return parseNudgeAnswers(JSON.parse(fenced[0]));
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const nested = rec.answers;
  if (nested && typeof nested === "object") {
    return answersFromRecord(nested as Record<string, unknown>);
  }
  return answersFromRecord(rec);
}

/** Real System One when the selected id is Jev. Anything else imitates it. */
export function isJevModel(id: string): boolean {
  const name = id.trim().toLowerCase();
  return /(^|\/)jev($|[-.])/.test(name);
}

export function systemOneUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/systemone")) return base;
  if (base.endsWith("/v1")) return `${base}/systemone`;
  return `${base}/v1/systemone`;
}

export function decideNudge(answers: NudgeAnswers): { nudge: boolean; why: string } {
  if (answers.waiting >= THRESHOLD) {
    return { nudge: false, why: `waiting on the user (${pct(answers.waiting)})` };
  }
  if (answers.progress != null && answers.progress < THRESHOLD) {
    return {
      nudge: false,
      why: `no progress since the last nudge (${pct(answers.progress)})`,
    };
  }
  if (answers.nudge < THRESHOLD) {
    return { nudge: false, why: `below threshold (${pct(answers.nudge)})` };
  }
  return { nudge: true, why: `nudge ${pct(answers.nudge)}` };
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function questions(hasPrevious: boolean): Record<string, unknown> {
  const nudge = {
    type: "noul",
    instructions: NUDGE_INSTRUCTIONS,
    criteria: {
      true: "Unfinished, unblocked work remains inside the user’s request and a nudge would move it forward.",
      false:
        "The work is done, the user must decide or supply something first, or a nudge would only repeat itself.",
    },
  };
  const waiting = { type: "noul", instructions: WAITING_INSTRUCTIONS };
  if (!hasPrevious) return { nudge, waiting };
  return {
    nudge,
    waiting,
    progress: { type: "noul", instructions: PROGRESS_INSTRUCTIONS },
  };
}

const IMITATE_SYSTEM = [
  "You imitate Jev, a typed yes/no judge. Reply with JSON only.",
  '{"nudge":0,"waiting":0,"progress":0}',
  "Each field is a probability from 0 to 1.",
  NUDGE_INSTRUCTIONS,
  `waiting: ${WAITING_INSTRUCTIONS}`,
  `progress: ${PROGRESS_INSTRUCTIONS}`,
  "Omit progress when previous_nudges is absent.",
].join("\n\n");

function nudgeState(input: {
  ctx: ToolContext;
  assistantText: string;
  toolNames: string[];
  marks: NudgeMark[];
}): Record<string, unknown> {
  const asks = (input.ctx.userAsks ?? [])
    .map((item) => clip(item))
    .filter(Boolean)
    .slice(-6);
  const state: Record<string, unknown> = {
    user_requests: asks,
    latest_assistant_message: clip(input.assistantText),
    recent_tool_calls: input.toolNames.slice(-12),
    turn_number: input.marks.length + 1,
  };
  if (input.marks.length) {
    state.previous_nudges = input.marks.map((mark) => ({
      tool_calls_after: mark.toolsAfter,
      assistant_text_at_nudge: clip(mark.text),
    }));
  }
  return state;
}

function usableJevKey(apiKey: string, transport?: string): boolean {
  if (!apiKey || apiKey === "oauth" || apiKey === "session" || apiKey === "agy") {
    return false;
  }
  return transport !== "oauth" && transport !== "web-bridge" && transport !== "antigravity";
}

export async function jevNudgeContinue(input: {
  ctx: ToolContext;
  assistantText: string;
  toolNames: string[];
  marks: NudgeMark[];
  fetch?: typeof fetch;
  complete?: (system: string, user: string) => Promise<string | null>;
}): Promise<{ note: string } | null> {
  if (input.ctx.signal?.aborted || input.ctx.skipJevNudge) return null;
  if ((input.ctx.spawnDepth ?? 0) > 0) return null;
  if (!input.ctx.dataDir) return null;
  if (input.marks.length >= MAX_NUDGES) return null;
  const text = input.assistantText.trim();
  if (!text || /模型請求失敗/.test(text)) return null;
  const { resolveLlm, llmComplete } = await import("./llm.ts");
  const target = resolveLlm(input.ctx.dataDir, input.ctx.env, "classifier");
  if (!target) return null;
  const state = nudgeState({ ...input, assistantText: text });
  const real = isJevModel(target.model) && usableJevKey(target.apiKey, target.transport);
  try {
    const answers = real
      ? await askSystemOne(target, state, input.marks.length > 0, input.fetch)
      : await askImitation(input, state);
    if (!answers) return null;
    const decision = decideNudge(answers);
    if (!decision.nudge) return null;
    return { note: `${real ? "jev" : "llm"} ${decision.why}` };
  } catch {
    return null;
  }

  async function askImitation(
    source: typeof input,
    body: Record<string, unknown>,
  ): Promise<NudgeAnswers | null> {
    if (source.complete) {
      return parseNudgeAnswers(await source.complete(IMITATE_SYSTEM, JSON.stringify(body)));
    }
    const done = await llmComplete({
      dataDir: source.ctx.dataDir!,
      env: source.ctx.env,
      system: IMITATE_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(body) }],
      temperature: 0,
      role: "classifier",
      prefer: { provider: target!.providerId, model: target!.model },
      tools: false,
      fast: true,
      toolCtx: {
        dataDir: source.ctx.dataDir,
        env: source.ctx.env,
        signal: source.ctx.signal,
        skipJevNudge: true,
        spawnDepth: 1,
      },
    });
    return parseNudgeAnswers(done?.text ?? "");
  }
}

async function askSystemOne(
  target: { baseUrl: string; apiKey: string; model: string },
  state: Record<string, unknown>,
  hasPrevious: boolean,
  fetchImpl: typeof fetch | undefined,
): Promise<NudgeAnswers | null> {
  const response = await (fetchImpl ?? fetch)(systemOneUrl(target.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${target.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: target.model,
      state,
      questions: questions(hasPrevious),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return parseNudgeAnswers(await response.json());
}
