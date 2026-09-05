import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { generatedDir, generatedPublicPath } from "./image-gen.ts";
import { defaultDataDir } from "./store.ts";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const WIN_EPOCH = 11_644_473_600;
export const TTS_TIMEOUT_MS = 30_000;
export const TTS_TEXT_CAP = 2_000;

const UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 ` +
  `Edg/${CHROMIUM_MAJOR}.0.0.0`;

export const DEFAULT_VOICE = "en-US-EmmaMultilingualNeural";

const VOICE_ALIAS: Record<string, string> = {
  ja: "ja-JP-NanamiNeural",
  "ja-jp": "ja-JP-NanamiNeural",
  jp: "ja-JP-NanamiNeural",
  nanami: "ja-JP-NanamiNeural",
  keita: "ja-JP-KeitaNeural",
  zh: "zh-TW-HsiaoChenNeural",
  "zh-tw": "zh-TW-HsiaoChenNeural",
  "zh-cn": "zh-CN-XiaoxiaoNeural",
  cn: "zh-CN-XiaoxiaoNeural",
  en: "en-US-EmmaMultilingualNeural",
  "en-us": "en-US-EmmaMultilingualNeural",
};

let clockSkewSeconds = 0;

export function resetTtsClockSkew(): void {
  clockSkewSeconds = 0;
}

export function generateSecMsGec(nowSec = Date.now() / 1000): string {
  // Windows FILETIME ticks are ~1.3e17, past Number.MAX_SAFE_INTEGER.
  let unix = Math.floor(nowSec + clockSkewSeconds);
  unix -= unix % 300;
  const ticks = BigInt(unix + WIN_EPOCH) * 10_000_000n;
  const payload = `${ticks.toString()}${TRUSTED_CLIENT_TOKEN}`;
  return createHash("sha256").update(payload, "ascii").digest("hex").toUpperCase();
}

export function pickVoice(voice = "", text = ""): string {
  const raw = String(voice || "").trim();
  if (/^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+Neural$/.test(raw)) return raw;
  const alias = VOICE_ALIAS[raw.toLowerCase()];
  if (alias) return alias;
  if (/[\u3040-\u30ff]/.test(text)) return VOICE_ALIAS.ja;
  if (/[\u4e00-\u9fff]/.test(text)) return VOICE_ALIAS["zh-tw"];
  return DEFAULT_VOICE;
}

export function escapeSsml(text: string): string {
  return String(text || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function jsDate(): string {
  return new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");
}

function connectId(): string {
  return randomUUID().replace(/-/g, "");
}

function wssHeaders(): Record<string, string> {
  return {
    pragma: "no-cache",
    "cache-control": "no-cache",
    origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "user-agent": UA,
    "accept-language": "en-US,en;q=0.9",
    cookie: `muid=${randomBytes(16).toString("hex").toUpperCase()};`,
  };
}

function parseRfc2616Date(raw: string): number | undefined {
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms / 1000 : undefined;
}

function applyClockSkewFromDate(header: string | undefined): void {
  if (!header) return;
  const server = parseRfc2616Date(header);
  if (server == null) return;
  clockSkewSeconds += server - Date.now() / 1000;
}

export function splitBinaryFrame(data: Buffer): { path: string; body: Buffer } | null {
  if (data.length < 2) return null;
  const headerLength = data.readUInt16BE(0);
  if (2 + headerLength > data.length) return null;
  const header = data.subarray(2, 2 + headerLength);
  const body = data.subarray(2 + headerLength);
  const pathLine = header.toString("utf8").split("\r\n").find((line) => line.startsWith("Path:"));
  const path = pathLine ? pathLine.slice(5).trim() : "";
  return { path, body };
}

function abortError(message = "tts aborted"): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

export async function synthesizeEdgeMp3(
  text: string,
  voice: string,
  opts: { signal?: AbortSignal } = {},
): Promise<Buffer> {
  if (opts.signal?.aborted) throw abortError();
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeSsml(text)}</prosody>` +
    `</voice></speak>`;
  const chunks: Buffer[] = [];
  const url =
    `${WSS_URL}&ConnectionId=${connectId()}` +
    `&Sec-MS-GEC=${generateSecMsGec()}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  return await new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => finish(abortError());
    const ws = new WebSocket(url, {
      headers: wssHeaders(),
      perMessageDeflate: false,
    });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (error) {
        reject(error);
        return;
      }
      const audio = Buffer.concat(chunks);
      if (audio.length < 32) reject(new Error("tts returned no audio"));
      else resolve(audio);
    };
    timer = setTimeout(() => finish(new Error("tts timed out")), TTS_TIMEOUT_MS);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    if (opts.signal?.aborted) onAbort();
    ws.on("unexpected-response", (_req, res) => {
      applyClockSkewFromDate(String(res.headers.date || ""));
      finish(new Error(`tts http ${res.statusCode}`));
    });
    ws.on("error", (error) =>
      finish(error instanceof Error ? error : new Error(String(error))),
    );
    ws.on("open", () => {
      const stamp = jsDate();
      ws.send(
        `X-Timestamp:${stamp}\r\n` +
          "Content-Type:application/json; charset=utf-8\r\n" +
          "Path:speech.config\r\n\r\n" +
          '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
          '"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"' +
          '},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n',
      );
      ws.send(
        `X-RequestId:${connectId()}\r\n` +
          "Content-Type:application/ssml+xml\r\n" +
          `X-Timestamp:${stamp}Z\r\n` +
          "Path:ssml\r\n\r\n" +
          ssml,
      );
    });
    ws.on("message", (raw, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        const parsed = splitBinaryFrame(buf);
        if (parsed?.path === "audio" && parsed.body.length) chunks.push(parsed.body);
        return;
      }
      if (String(raw).includes("Path:turn.end")) finish();
    });
    ws.on("close", () => {
      if (!settled) finish(chunks.length ? undefined : new Error("tts closed"));
    });
  });
}

export async function generateSpeech(input: {
  text: string;
  voice?: string;
  dataDir?: string;
  signal?: AbortSignal;
}): Promise<{ text: string; isError?: boolean }> {
  const text = String(input.text || "").trim();
  if (!text) return { text: "tts needs text", isError: true };
  if (text.length > TTS_TEXT_CAP) {
    return { text: `tts text is too long (max ${TTS_TEXT_CAP} chars)`, isError: true };
  }
  const voice = pickVoice(input.voice, text);
  const dataDir = input.dataDir || defaultDataDir();
  try {
    if (input.signal?.aborted) throw abortError();
    let audio: Buffer;
    try {
      audio = await synthesizeEdgeMp3(text, voice, { signal: input.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/tts http 403/.test(message)) throw error;
      audio = await synthesizeEdgeMp3(text, voice, { signal: input.signal });
    }
    const name = `${randomUUID()}.mp3`;
    const dir = generatedDir(dataDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), audio);
    const publicPath = generatedPublicPath(name);
    return {
      text: `語音（${voice}）\n\n[${text.slice(0, 80)}](${publicPath})`,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { text: `tts failed: ${message.slice(0, 240)}`, isError: true };
  }
}
