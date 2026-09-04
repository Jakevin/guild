import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setFreebuffSdkHooks, type FreebuffSdkClient } from "../src/freebuff-bridge.ts";
import { setFreebuffCredentialsPathForTest } from "../src/freebuff-auth.ts";
import { writeFreebuffState } from "../src/freebuff-chat.ts";

export function writeOfficialCreds(path: string, token = "test-token"): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        default: {
          name: "Tester",
          email: "tester@example.com",
          authToken: token,
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

export function markGuildConnected(dataDir: string): void {
  writeFreebuffState(dataDir, {
    connectedAt: "2026-09-04T00:00:00.000Z",
    pending: false,
    models: ["deepseek-v4-flash-0731", "glm-5.3-flash"],
    defaultModel: "deepseek-v4-flash-0731",
  });
}

export type FakeSdkRun = {
  prompts: string[];
  replies: string[];
  autoReply: string | null;
  hang: boolean;
  delayMs: number;
  streamChunks?: string[];
  lastOptions?: { costMode?: string; agent?: string; overrideTools?: unknown };
};

export function fakeSdkPage(init: Partial<FakeSdkRun> = {}): FakeSdkRun {
  return {
    prompts: [],
    replies: [],
    autoReply: "pong",
    hang: false,
    delayMs: 0,
    ...init,
  };
}

export function hookFakeSdk(home: string, page: FakeSdkRun, extra?: { streamIdleMs?: number }): string {
  const creds = join(home, "manicode-credentials.json");
  writeOfficialCreds(creds);
  markGuildConnected(home);
  setFreebuffCredentialsPathForTest(creds);
  setFreebuffSdkHooks({
    credentialsPath: creds,
    cwd: join(home, "scratch"),
    streamIdleMs: extra?.streamIdleMs,
    ensureSession: async () => ({
      instanceId: "inst-1",
      model: "deepseek/deepseek-v4-flash",
    }),
    createClient: (options) => {
      const client: FreebuffSdkClient = {
        async run(opts) {
          page.lastOptions = {
            costMode: opts.costMode,
            agent: opts.agent,
            overrideTools: options.overrideTools,
          };
          page.prompts.push(opts.prompt);
          if (page.hang) {
            await new Promise<never>((_, reject) => {
              const fail = () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              };
              if (opts.signal?.aborted) {
                fail();
                return;
              }
              opts.signal?.addEventListener("abort", fail, { once: true });
            });
          }
          if (page.delayMs) {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(resolve, page.delayMs);
              const fail = () => {
                clearTimeout(timer);
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              };
              if (opts.signal?.aborted) {
                fail();
                return;
              }
              opts.signal?.addEventListener("abort", fail, { once: true });
            });
          }
          if (opts.signal?.aborted) {
            const err = new Error("aborted");
            err.name = "AbortError";
            throw err;
          }
          const text = page.replies.length
            ? page.replies.shift()!
            : (page.autoReply ?? "pong");
          if (page.streamChunks) {
            for (const chunk of page.streamChunks) opts.handleStreamChunk?.(chunk);
          } else {
            opts.handleStreamChunk?.(text);
          }
          return { output: { type: "lastMessage", value: [{ type: "text", text }] } };
        },
      };
      return client;
    },
  });
  return creds;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function loginFetch(opts: { user?: boolean; expiresInMs?: number } = {}): typeof fetch {
  const expiresAt = new Date(Date.now() + (opts.expiresInMs ?? 300_000)).toISOString();
  return (async (input) => {
    const url = String(input);
    if (url.includes("/api/auth/cli/code")) {
      return jsonResponse({
        loginUrl: "https://freebuff.com/login?cli=abc",
        fingerprintHash: "hash",
        expiresAt,
      });
    }
    if (url.includes("/api/auth/cli/status")) {
      if (!opts.user) return jsonResponse({});
      return jsonResponse({
        user: { name: "Tester", email: "tester@example.com", authToken: "tok-live" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}
