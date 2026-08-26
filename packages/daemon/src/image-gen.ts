import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { grokCliHeaders, storedAccessToken } from "./oauth.ts";
import { defaultDataDir } from "./store.ts";

/**
 * One Imagine HTTP call. Codex waits on the same stream idle as chat:
 * `DEFAULT_STREAM_IDLE_TIMEOUT_MS` = 300_000. DSH community `dsh-image-gen`
 * uses requestTimeoutMs 120_000; official DSH leaves tools undeadlined unless
 * they declare timeoutMs. Pi image generateImages uses the OpenAI SDK 10 min
 * default when timeoutMs is omitted.
 */
export const IMAGE_GEN_TIMEOUT_MS = 300_000;
const ATTEMPT_MS = IMAGE_GEN_TIMEOUT_MS;
/** DSH `filesApiTimeoutMs` default: one minute to fetch a resolved image. */
const DOWNLOAD_MS = 60_000;

const ASPECT = new Set([
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "19.5:9",
  "9:19.5",
  "20:9",
  "9:20",
]);

export function isSafeGeneratedName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.includes("..");
}

export function generatedDir(dataDir: string): string {
  return join(dataDir, "generated");
}

export function generatedPublicPath(name: string): string {
  return `/generated/${name}`;
}

function resolveKey(raw: unknown, env: NodeJS.ProcessEnv): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("$")) return (env[value.slice(1)] ?? "").trim();
  return value;
}

function readProviderKey(
  dataDir: string,
  env: NodeJS.ProcessEnv,
  id: string,
): string {
  try {
    const file = JSON.parse(readFileSync(join(dataDir, "models.json"), "utf8")) as {
      providers?: Record<string, { apiKey?: string }>;
    };
    return resolveKey(file.providers?.[id]?.apiKey, env);
  } catch {
    return "";
  }
}

function extForMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

type Route = {
  url: string;
  token: string;
  headers: Record<string, string>;
  model: string;
};

function routes(dataDir: string, env: NodeJS.ProcessEnv): Route[] {
  const grokHeaders = grokCliHeaders();
  const oauth = storedAccessToken(dataDir, "xai") || "";
  const xaiKey =
    readProviderKey(dataDir, env, "xai") || (env.XAI_API_KEY ?? "").trim();
  const openaiKey =
    readProviderKey(dataDir, env, "openai") || (env.OPENAI_API_KEY ?? "").trim();
  const out: Route[] = [];
  if (oauth) {
    out.push({
      url: "https://api.x.ai/v1/images/generations",
      token: oauth,
      headers: grokHeaders,
      model: "grok-imagine-image-2.0",
    });
  }
  if (xaiKey && xaiKey !== oauth) {
    out.push({
      url: "https://api.x.ai/v1/images/generations",
      token: xaiKey,
      headers: {},
      model: "grok-imagine-image-2.0",
    });
  }
  if (openaiKey) {
    out.push({
      url: "https://api.openai.com/v1/images/generations",
      token: openaiKey,
      headers: {},
      model: "gpt-image-1",
    });
  }
  return out;
}

function saveBytes(
  dataDir: string,
  bytes: Buffer,
  mime: string,
): { abs: string; name: string; publicPath: string } {
  const name = `${randomUUID()}.${extForMime(mime)}`;
  const dir = generatedDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const abs = join(dir, name);
  writeFileSync(abs, bytes);
  return { abs, name, publicPath: generatedPublicPath(name) };
}

async function downloadImage(
  url: string,
  token: string,
  headers: Record<string, string>,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const attempts: Record<string, string>[] = [
    {},
    { authorization: `Bearer ${token}`, ...headers },
  ];
  for (const extra of attempts) {
    try {
      const res = await fetch(url, {
        headers: extra,
        signal: AbortSignal.timeout(DOWNLOAD_MS),
      });
      if (!res.ok) continue;
      const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length < 32) continue;
      return { bytes, mime };
    } catch {
      /* try next auth mode */
    }
  }
  return null;
}

type ImageHit = { bytes: Buffer; mime: string; model: string };

async function postGenerate(
  route: Route,
  prompt: string,
  aspect: string,
): Promise<ImageHit | { error: string }> {
  const body: Record<string, unknown> = {
    model: route.model,
    prompt,
    n: 1,
  };
  if (route.model.startsWith("gpt-image")) body.response_format = "b64_json";
  if (aspect && aspect !== "auto") body.aspect_ratio = aspect;
  const res = await fetch(route.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${route.token}`,
      "content-type": "application/json",
      ...route.headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ATTEMPT_MS),
  });
  const raw = await res.text();
  if (!res.ok) {
    return { error: `${res.status} ${raw.slice(0, 180)}` };
  }
  let parsed: {
    data?: {
      url?: string;
      b64_json?: string;
      mime_type?: string;
    }[];
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return { error: "unparseable image response" };
  }
  const item = parsed.data?.[0];
  if (item?.b64_json) {
    return {
      bytes: Buffer.from(item.b64_json, "base64"),
      mime: item.mime_type || "image/png",
      model: route.model,
    };
  }
  if (item?.url) {
    const got = await downloadImage(item.url, route.token, route.headers);
    if (!got) return { error: "failed to download image url" };
    return { ...got, mime: item.mime_type || got.mime, model: route.model };
  }
  return { error: "image response had no url or b64" };
}

export async function generateImage(input: {
  prompt: string;
  aspectRatio?: string;
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ text: string; isError: boolean }> {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) return { text: "prompt is required", isError: true };
  const aspect = String(input.aspectRatio || "").trim();
  if (aspect && !ASPECT.has(aspect)) {
    return {
      text: `unknown aspect_ratio ${aspect}. Use auto, 1:1, 16:9, 9:16, …`,
      isError: true,
    };
  }
  const env = input.env ?? process.env;
  const dataDir = input.dataDir || defaultDataDir(env);
  const list = routes(dataDir, env);
  if (!list.length) {
    return {
      text: "沒有可用的生圖模型。到模型頁連接 xAI Grok 訂閱，或填 xAI / OpenAI API key。",
      isError: true,
    };
  }
  const errors: string[] = [];
  const deadline = Date.now() + IMAGE_GEN_TIMEOUT_MS;
  for (const route of list) {
    if (Date.now() >= deadline) break;
    try {
      const hit = await postGenerate(route, prompt, aspect);
      if ("bytes" in hit) {
        const saved = saveBytes(dataDir, hit.bytes, hit.mime);
        return {
          text: [
            `generated with ${hit.model}`,
            `path: ${saved.abs}`,
            `markdown: ![${prompt.slice(0, 80)}](${saved.publicPath})`,
          ].join("\n"),
          isError: false,
        };
      }
      errors.push(`${route.model} @ ${route.url}: ${hit.error}`);
      if (/timeout|aborted/i.test(hit.error)) break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${route.model} @ ${route.url}: ${message}`);
      if (/timeout|aborted/i.test(message)) break;
    }
  }
  return {
    text: `生圖失敗：${errors.slice(0, 3).join(" | ") || "timeout"}`,
    isError: true,
  };
}
