/** Hermes-shaped schedules plus natural language: `in 30m`, `每10分鐘`, `每天9點`. */

export const CRON_TICK_MS = 60_000;
export const CRON_MIN_EVERY_MS = 60_000;
export const CRON_JOB_CAP = 50;

export type CronKind = "once" | "every" | "cron";

export type CronSpec = {
  raw: string;
  kind: CronKind;
  atMs?: number;
  everyMs?: number;
  cron?: string;
};

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDurationMs(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  const match = text.match(/^(\d+)\s*(s|m|h|d|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|day|days)$/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = match[2][0] as "s" | "m" | "h" | "d";
  return n * UNIT_MS[unit];
}

function raiseEvery(ms: number): number {
  return Math.max(CRON_MIN_EVERY_MS, ms);
}

export function parseCronSchedule(raw: string, now = Date.now()): CronSpec {
  const text = String(raw || "").trim();
  if (!text) throw new Error("schedule is required");

  const iso = Date.parse(text);
  if (Number.isFinite(iso) && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    if (iso <= now) throw new Error("one-shot time is in the past");
    return { raw: text, kind: "once", atMs: iso };
  }

  const once = text.match(/^in\s+(.+)$/i);
  if (once) {
    const ms = parseDurationMs(once[1]);
    if (!ms) throw new Error(`bad delay: ${once[1]}`);
    return { raw: text, kind: "once", atMs: now + raiseEvery(ms) };
  }

  const everyWord = text.match(/^every\s+(.+)$/i);
  if (everyWord) {
    const rest = everyWord[1].trim().toLowerCase();
    if (rest === "hour" || rest === "hours") {
      return { raw: text, kind: "every", everyMs: UNIT_MS.h };
    }
    if (rest === "day" || rest === "days") {
      return { raw: text, kind: "every", everyMs: UNIT_MS.d };
    }
    const ms = parseDurationMs(rest);
    if (!ms) throw new Error(`bad interval: ${everyWord[1]}`);
    return { raw: text, kind: "every", everyMs: raiseEvery(ms) };
  }

  const bare = parseDurationMs(text);
  if (bare) {
    return { raw: text, kind: "every", everyMs: raiseEvery(bare) };
  }

  if (isFiveFieldCron(text)) {
    nextCronFire(text, now);
    return { raw: text, kind: "cron", cron: text };
  }

  const natural = parseNaturalSchedule(text, now);
  if (natural) return natural;

  throw new Error(`bad schedule: ${text}`);
}

const ZH_UNIT: Record<string, keyof typeof UNIT_MS> = {
  秒: "s",
  秒鐘: "s",
  分: "m",
  分鐘: "m",
  小时: "h",
  小時: "h",
  天: "d",
  日: "d",
};

function zhDurationMs(n: number, unitRaw: string): number | null {
  const unit = ZH_UNIT[unitRaw.replace(/^[个個]/, "")];
  if (!unit || !Number.isFinite(n) || n <= 0) return null;
  return n * UNIT_MS[unit];
}

function parseClock(raw: string): { hour: number; minute: number } | null {
  let s = raw.trim();
  if (!s) return null;
  let period: "am" | "pm" | "" = "";
  if (/^(早上|上午|清晨|今早)/.test(s)) {
    period = "am";
    s = s.replace(/^(早上|上午|清晨|今早)\s*/, "");
  } else if (/^(晚上|傍晚|今晚|下午)/.test(s)) {
    period = "pm";
    s = s.replace(/^(晚上|傍晚|今晚|下午)\s*/, "");
  } else if (/^(中午)/.test(s)) {
    s = s.replace(/^(中午)\s*/, "");
    if (!s) return { hour: 12, minute: 0 };
    period = "pm";
  } else if (/^(凌晨|午夜)/.test(s)) {
    period = "am";
    s = s.replace(/^(凌晨|午夜)\s*/, "");
    if (!s) return { hour: 0, minute: 0 };
  }
  const enMeridiem = s.match(/^(.*?)(?:\s*)(am|pm)$/i);
  if (enMeridiem) {
    period = enMeridiem[2].toLowerCase() as "am" | "pm";
    s = enMeridiem[1].trim();
  }
  let hour = -1;
  let minute = 0;
  const half = s.match(/^(\d{1,2})\s*[點点]半$/);
  const zh = s.match(/^(\d{1,2})\s*[點点](?:\s*(\d{1,2})\s*分?)?$/);
  const colon = s.match(/^(\d{1,2})[:：](\d{2})$/);
  const hourOnly = s.match(/^(\d{1,2})$/);
  if (half) {
    hour = Number(half[1]);
    minute = 30;
  } else if (zh) {
    hour = Number(zh[1]);
    minute = zh[2] ? Number(zh[2]) : 0;
  } else if (colon) {
    hour = Number(colon[1]);
    minute = Number(colon[2]);
  } else if (hourOnly) {
    hour = Number(hourOnly[1]);
    minute = 0;
  } else {
    return null;
  }
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (minute < 0 || minute > 59 || hour < 0 || hour > 24) return null;
  if (hour === 24) {
    if (minute !== 0) return null;
    hour = 0;
  }
  if (period === "am") {
    if (hour === 12) hour = 0;
    else if (hour > 12) return null;
  } else if (period === "pm") {
    if (hour < 12) hour += 12;
  }
  if (hour > 23) return null;
  return { hour, minute };
}

function atLocal(
  fromMs: number,
  hour: number,
  minute: number,
  dayOffset: number,
): number {
  const d = new Date(fromMs);
  d.setSeconds(0, 0);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** Chinese / leftover English phrases the model may pass through as schedule. */
export function parseNaturalSchedule(text: string, now: number): CronSpec | null {
  const folded = text.trim().replace(/\s+/g, " ");
  if (!folded) return null;

  const everyZh = folded.match(
    /^每(?:隔)?\s*(\d+)\s*(秒鐘?|分鐘?|个?小时|個?小時|[天日])$/,
  );
  if (everyZh) {
    const ms = zhDurationMs(Number(everyZh[1]), everyZh[2]);
    if (ms) return { raw: text, kind: "every", everyMs: raiseEvery(ms) };
  }
  if (/^每(?:個|个)?(?:小時|小时)$/.test(folded)) {
    return { raw: text, kind: "every", everyMs: UNIT_MS.h };
  }
  if (/^每(?:一)?天$/.test(folded) || folded === "每日") {
    return { raw: text, kind: "every", everyMs: UNIT_MS.d };
  }

  const laterZh = folded.match(
    /^(?:再|過|过)?\s*(\d+)\s*(秒鐘?|分鐘?|个?小时|個?小時|[天日])\s*(?:後|后|以後|以后|之後|之后)$/,
  );
  if (laterZh) {
    const ms = zhDurationMs(Number(laterZh[1]), laterZh[2]);
    if (ms) return { raw: text, kind: "once", atMs: now + raiseEvery(ms) };
  }

  const daily = folded.match(/^(?:每天|每日)\s*(.+)$/);
  if (daily) {
    const clock = parseClock(daily[1]);
    if (clock) {
      return {
        raw: text,
        kind: "cron",
        cron: `${clock.minute} ${clock.hour} * * *`,
      };
    }
  }

  const tomorrow = folded.match(/^(?:明天|明日)\s*(.+)$/);
  if (tomorrow) {
    const clock = parseClock(tomorrow[1]);
    if (clock) {
      const at = atLocal(now, clock.hour, clock.minute, 1);
      if (at <= now) throw new Error("one-shot time is in the past");
      return { raw: text, kind: "once", atMs: at };
    }
  }

  const enTomorrow = folded.match(/^tomorrow\s+(.+)$/i);
  if (enTomorrow) {
    const clock = parseClock(enTomorrow[1]);
    if (clock) {
      const at = atLocal(now, clock.hour, clock.minute, 1);
      if (at <= now) throw new Error("one-shot time is in the past");
      return { raw: text, kind: "once", atMs: at };
    }
  }

  const dailyEn = folded.match(/^(?:daily|every day)\s+(?:at\s+)?(.+)$/i);
  if (dailyEn) {
    const clock = parseClock(dailyEn[1]);
    if (clock) {
      return {
        raw: text,
        kind: "cron",
        cron: `${clock.minute} ${clock.hour} * * *`,
      };
    }
  }

  return null;
}

export function nextRunAt(spec: CronSpec, fromMs = Date.now()): number {
  if (spec.kind === "once") {
    const at = spec.atMs ?? fromMs;
    return at;
  }
  if (spec.kind === "every") {
    return fromMs + (spec.everyMs ?? CRON_MIN_EVERY_MS);
  }
  return nextCronFire(spec.cron || spec.raw, fromMs);
}

export function followingRun(spec: CronSpec, fromMs = Date.now()): number | null {
  if (spec.kind === "once") return null;
  if (spec.kind === "every") return fromMs + (spec.everyMs ?? CRON_MIN_EVERY_MS);
  return nextCronFire(spec.cron || spec.raw, fromMs);
}

function isFiveFieldCron(text: string): boolean {
  const parts = text.split(/\s+/);
  return parts.length === 5 && parts.every((part) => /^[\d*,\-\/]+$/.test(part));
}

type CronFields = {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
};

function parseCronField(raw: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const chunk of raw.split(",")) {
    const [range, stepRaw] = chunk.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isFinite(step) || step < 1) {
      throw new Error(`bad cron field: ${raw}`);
    }
    let start = min;
    let end = max;
    if (range !== "*") {
      if (range.includes("-")) {
        const [a, b] = range.split("-").map(Number);
        start = a;
        end = b;
      } else {
        start = Number(range);
        end = start;
      }
    }
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      throw new Error(`bad cron field: ${raw}`);
    }
    for (let i = start; i <= end; i += step) out.add(i);
  }
  if (!out.size) throw new Error(`bad cron field: ${raw}`);
  return out;
}

function parseFive(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("cron needs 5 fields");
  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    day: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    weekday: parseWeekdayField(parts[4]),
  };
}

function parseWeekdayField(raw: string): Set<number> {
  const values = parseCronField(raw, 0, 7);
  const out = new Set<number>();
  for (const value of values) out.add(value === 7 ? 0 : value);
  return out;
}

function matchCron(fields: CronFields, date: Date): boolean {
  if (
    !fields.minute.has(date.getMinutes()) ||
    !fields.hour.has(date.getHours()) ||
    !fields.month.has(date.getMonth() + 1)
  ) {
    return false;
  }
  const dayOk = fields.day.has(date.getDate());
  const weekOk = fields.weekday.has(date.getDay());
  const dayRestricted = fields.day.size < 31;
  const weekRestricted = fields.weekday.size < 7;
  return dayRestricted && weekRestricted ? dayOk || weekOk : dayOk && weekOk;
}

export function nextCronFire(expr: string, fromMs: number): number {
  const fields = parseFive(expr);
  const start = new Date(fromMs);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  const limit = fromMs + 366 * 24 * 60 * 60 * 1000;
  for (let t = start.getTime(); t <= limit; t += 60_000) {
    if (matchCron(fields, new Date(t))) return t;
  }
  throw new Error("cron expression never fires");
}

export function tokenizeCronSlash(text: string): string[] {
  const out: string[] = [];
  const src = text.trim();
  let i = 0;
  while (i < src.length) {
    while (src[i] === " ") i += 1;
    if (i >= src.length) break;
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      i += 1;
      let buf = "";
      while (i < src.length && src[i] !== q) {
        buf += src[i];
        i += 1;
      }
      if (src[i] === q) i += 1;
      out.push(buf);
      continue;
    }
    let buf = "";
    while (i < src.length && src[i] !== " ") {
      buf += src[i];
      i += 1;
    }
    out.push(buf);
  }
  return out;
}
