export const DEFAULT_FREEBUFF_APP_URL = "https://www.codebuff.com";
export const FREEBUFF_SESSION_ENDPOINT = "/api/v1/freebuff/session";
export const FREEBUFF_MODEL_HEADER = "x-freebuff-model";
export const DEFAULT_FREEBUFF_SESSION_MODEL = "deepseek/deepseek-v4-flash";

export type ActiveFreebuffSession = {
  instanceId: string;
  model: string;
  admittedAt?: string;
  expiresAt?: string;
  remainingMs?: number;
};

export class FreebuffSessionError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly responseCode?: string,
  ) {
    super(message);
    this.name = "FreebuffSessionError";
  }
}

export type FreebuffSessionManagerOptions = {
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  refreshBeforeMs?: number;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringField(body: JsonObject, name: string): string | undefined {
  const value = body[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "") || DEFAULT_FREEBUFF_APP_URL;
}

function responseCode(body: JsonObject | undefined): string | undefined {
  return body ? stringField(body, "status") : undefined;
}

function sessionFailureMessage(body: JsonObject | undefined, statusCode: number): string {
  const status = responseCode(body);
  if (statusCode === 401) return "freebuff_login_required";
  const supplied = body && stringField(body, "message");
  if (supplied && supplied.startsWith("freebuff_")) return supplied;
  switch (status) {
    case "country_blocked":
    case "model_unavailable":
      return "freebuff_limited_mode";
    case "model_locked":
    case "rate_limited":
    case "spend_limited":
    case "ip_capped":
      return "freebuff_session_cap";
    case "banned":
      return "freebuff_login_required";
    default:
      return supplied
        ? `Freebuff session admission failed: ${supplied}`
        : `Freebuff session admission failed with HTTP ${statusCode}.`;
  }
}

function activeSession(body: JsonObject | undefined, requestedModel: string): ActiveFreebuffSession {
  if (responseCode(body) !== "active") {
    throw new FreebuffSessionError(sessionFailureMessage(body, 200), 200, responseCode(body));
  }
  const instanceId = body && stringField(body, "instanceId");
  if (!instanceId) {
    throw new FreebuffSessionError(
      "Freebuff returned an active session without an instance id.",
      200,
      "invalid_response",
    );
  }
  const model = body && stringField(body, "model");
  return {
    instanceId,
    model: model ?? requestedModel,
    ...(stringField(body, "admittedAt") ? { admittedAt: stringField(body, "admittedAt") } : {}),
    ...(stringField(body, "expiresAt") ? { expiresAt: stringField(body, "expiresAt") } : {}),
    ...(typeof body?.remainingMs === "number" ? { remainingMs: body.remainingMs } : {}),
  };
}

type OwnedSession = ActiveFreebuffSession & { token: string };

export class FreebuffSessionManager {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly refreshBeforeMs: number;
  private readonly active = new Map<string, OwnedSession>();
  private readonly pending = new Map<string, Promise<ActiveFreebuffSession>>();

  constructor(options: FreebuffSessionManagerOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_FREEBUFF_APP_URL);
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.refreshBeforeMs = options.refreshBeforeMs ?? 15_000;
  }

  get endpoint(): string {
    return `${this.baseUrl}${FREEBUFF_SESSION_ENDPOINT}`;
  }

  async ensure(
    token: string,
    model = DEFAULT_FREEBUFF_SESSION_MODEL,
    signal?: AbortSignal,
  ): Promise<ActiveFreebuffSession> {
    const authToken = token.trim();
    const requestedModel = model.trim() || DEFAULT_FREEBUFF_SESSION_MODEL;
    if (!authToken) {
      throw new FreebuffSessionError("freebuff_login_required", 401, "unauthorized");
    }
    const key = `${authToken}\u0000${requestedModel}`;
    const current = this.active.get(key);
    if (current && !this.isExpired(current)) return current;
    if (current) this.active.delete(key);
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const admission = this.admit(authToken, requestedModel, signal);
    this.pending.set(key, admission);
    try {
      return await admission;
    } finally {
      if (this.pending.get(key) === admission) this.pending.delete(key);
    }
  }

  invalidate(token: string, model?: string): void {
    const prefix = `${token.trim()}\u0000`;
    for (const key of this.active.keys()) {
      if (model ? key === `${prefix}${model.trim()}` : key.startsWith(prefix)) {
        this.active.delete(key);
      }
    }
  }

  async releaseAll(): Promise<void> {
    const sessions = [...this.active.values()];
    this.active.clear();
    await Promise.allSettled(sessions.map((session) => this.release(session)));
  }

  private isExpired(session: ActiveFreebuffSession): boolean {
    if (typeof session.expiresAt === "string") {
      const raw = session.expiresAt.trim();
      const expiresAtMs = /^\d+$/.test(raw)
        ? Number(raw) < 1e12
          ? Number(raw) * 1000
          : Number(raw)
        : Date.parse(raw);
      if (Number.isFinite(expiresAtMs)) return expiresAtMs <= this.now() + this.refreshBeforeMs;
    }
    if (typeof session.remainingMs === "number") return session.remainingMs <= this.refreshBeforeMs;
    return false;
  }

  private async admit(
    token: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<ActiveFreebuffSession> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          [FREEBUFF_MODEL_HEADER]: model,
        },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new FreebuffSessionError(
        `Could not reach the Freebuff session service: ${error instanceof Error ? error.message : String(error)}`,
        503,
        "network_error",
      );
    }
    const body = object(await response.json().catch(() => undefined));
    if (!response.ok) {
      throw new FreebuffSessionError(
        sessionFailureMessage(body, response.status),
        response.status,
        responseCode(body),
      );
    }
    const session = activeSession(body, model);
    this.active.set(`${token}\u0000${model}`, { ...session, token });
    return session;
  }

  private async release(session: OwnedSession): Promise<void> {
    try {
      await this.fetchImpl(this.endpoint, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.token}` },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      /* server-side sweep is the backstop */
    }
  }
}

const managers = new Map<string, FreebuffSessionManager>();

export function getFreebuffSessionManager(
  baseUrl = DEFAULT_FREEBUFF_APP_URL,
): FreebuffSessionManager {
  const normalized = normalizeBaseUrl(baseUrl);
  const existing = managers.get(normalized);
  if (existing) return existing;
  const manager = new FreebuffSessionManager({ baseUrl: normalized });
  managers.set(normalized, manager);
  return manager;
}

export async function releaseFreebuffSessions(): Promise<void> {
  await Promise.all([...managers.values()].map((manager) => manager.releaseAll()));
}
