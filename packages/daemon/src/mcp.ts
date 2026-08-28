import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type McpLaunch = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
};

export type McpServer = {
  id: string;
  name: string;
  source: "user" | "host";
  host?: string;
  launch: McpLaunch;
  enabled: boolean;
};

export type McpToolRef = {
  callName: string;
  server: string;
  tool: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

class McpSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private buf = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private ready: Promise<void>;

  constructor(launch: McpLaunch) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") env[key] = value;
    }
    Object.assign(env, launch.env || {});
    env.PYTHONUNBUFFERED = "1";
    this.child = spawn(launch.command, launch.args, {
      cwd: launch.cwd || undefined,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.stderr.on("data", () => {
      /* MCP logs belong on stderr */
    });
    this.child.on("error", (err) => {
      for (const wait of this.pending.values()) wait.reject(err);
      this.pending.clear();
    });
    this.child.on("exit", () => {
      const err = new Error("mcp server exited");
      for (const wait of this.pending.values()) wait.reject(err);
      this.pending.clear();
    });
    this.ready = new Promise((resolve, reject) => {
      this.child.once("error", reject);
      this.handshake().then(resolve, reject);
    });
  }

  private async handshake(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "guild", version: "0.0.1" },
    });
    this.notify("notifications/initialized");
  }

  async ensure(): Promise<void> {
    await this.ready;
  }

  async listTools(): Promise<
    { name: string; description?: string; inputSchema?: Record<string, unknown> }[]
  > {
    await this.ready;
    const result = (await this.request("tools/list", {})) as {
      tools?: {
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }[];
    };
    return Array.isArray(result.tools) ? result.tools : [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string; isError: boolean }> {
    await this.ready;
    const result = (await this.request("tools/call", {
      name,
      arguments: args,
    })) as {
      isError?: boolean;
      content?: { type?: string; text?: string }[];
    };
    const text = (result.content || [])
      .filter((part) => part && part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n")
      .trim();
    return {
      text: text || (result.isError ? "mcp tool failed" : "(empty)"),
      isError: Boolean(result.isError),
    };
  }

  close(): void {
    try {
      this.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }

  private notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp timeout: ${method}`));
      }, method === "tools/call" ? 300_000 : 8_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private write(msg: unknown): void {
    const json = JSON.stringify(msg);
    const payload = Buffer.from(json, "utf8");
    this.child.stdin.write(`Content-Length: ${payload.length}\r\n\r\n`);
    this.child.stdin.write(payload);
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      const framed = this.takeFrame();
      if (framed === null) break;
      this.dispatch(framed);
    }
  }

  private takeFrame(): string | null {
    const headerEnd = this.buf.indexOf("\r\n\r\n");
    if (headerEnd >= 0) {
      const header = this.buf.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buf = this.buf.subarray(headerEnd + 4);
        return null;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buf.length < start + length) return null;
      const json = this.buf.subarray(start, start + length).toString("utf8");
      this.buf = this.buf.subarray(start + length);
      return json;
    }
    const nl = this.buf.indexOf("\n");
    if (nl < 0) return null;
    const line = this.buf.subarray(0, nl).toString("utf8").trim();
    this.buf = this.buf.subarray(nl + 1);
    if (!line.startsWith("{")) return this.takeFrame();
    return line;
  }

  private dispatch(raw: string): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (typeof msg.id !== "number") return;
    const wait = this.pending.get(msg.id);
    if (!wait) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      wait.reject(new Error(msg.error.message || "mcp error"));
      return;
    }
    wait.resolve(msg.result);
  }
}

const sessions = new Map<string, McpSession>();

export function mcpPath(dataDir: string): string {
  return join(dataDir, "mcp.json");
}

export function readMcpFile(dataDir: string): Record<string, McpLaunch> {
  const file = mcpPath(dataDir);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    return normalizeMap(parsed.mcpServers || {});
  } catch {
    return {};
  }
}

export function writeMcpFile(
  dataDir: string,
  servers: Record<string, McpLaunch>,
): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    mcpPath(dataDir),
    `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`,
  );
}

export function listGuildMcp(dataDir: string): McpServer[] {
  return Object.entries(readMcpFile(dataDir)).map(([name, launch]) => ({
    id: `guild:${name}`,
    name,
    source: "user" as const,
    launch,
    enabled: true,
  }));
}

export function upsertGuildMcp(
  dataDir: string,
  name: string,
  launch: McpLaunch,
): McpServer {
  const slug = sanitize(name) || "server";
  if (launch.url && !launch.command.trim()) {
    throw new Error("stdio MCP needs a command (HTTP MCP is not wired yet)");
  }
  if (!launch.command.trim()) throw new Error("command is required");
  const current = readMcpFile(dataDir);
  current[slug] = {
    command: launch.command.trim(),
    args: launch.args || [],
    ...(launch.env && Object.keys(launch.env).length ? { env: launch.env } : {}),
    ...(launch.cwd ? { cwd: launch.cwd } : {}),
  };
  writeMcpFile(dataDir, current);
  dropSession(slug);
  return {
    id: `guild:${slug}`,
    name: slug,
    source: "user",
    launch: current[slug],
    enabled: true,
  };
}

export function removeGuildMcp(dataDir: string, name: string): { ok: true } {
  const current = readMcpFile(dataDir);
  const slug = name.replace(/^guild:/, "");
  if (!current[slug]) throw new Error("mcp server not found");
  delete current[slug];
  writeMcpFile(dataDir, current);
  dropSession(slug);
  return { ok: true };
}

export function listHostMcp(home = homedir()): McpServer[] {
  const out: McpServer[] = [];
  const seen = new Set<string>();
  const push = (item: McpServer) => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...item, enabled: true });
  };
  for (const item of readClaudeMcp(join(home, ".claude.json"), "Claude")) {
    push(item);
  }
  for (const item of readJsonMcp(join(home, ".cursor", "mcp.json"), "Cursor")) {
    push(item);
  }
  for (const item of readCodexMcp(join(home, ".codex", "config.toml"), "Codex")) {
    push(item);
  }
  return out;
}

export function listActiveMcp(dataDir: string, home = homedir()): McpServer[] {
  const guild = listGuildMcp(dataDir);
  const taken = new Set(guild.map((server) => server.name.toLowerCase()));
  const host = listHostMcp(home).filter(
    (server) => !taken.has(server.name.toLowerCase()),
  );
  return guild.concat(host);
}

export function importHostMcp(dataDir: string, hostId: string): McpServer {
  const hit = listHostMcp().find((item) => item.id === hostId);
  if (!hit) throw new Error("host mcp not found");
  return upsertGuildMcp(dataDir, hit.name, hit.launch);
}

export async function listMcpToolRefs(
  dataDir: string,
  home = homedir(),
): Promise<McpToolRef[]> {
  const listed = await Promise.all(
    listActiveMcp(dataDir, home).map(async (server) => {
      if (server.launch.url && !server.launch.command) return [];
      try {
        const session = await sessionFor(server);
        const tools = await session.listTools();
        return tools.slice(0, 40).map((tool) => ({
          callName: callName(server.name, tool.name),
          server: server.name,
          tool: tool.name,
          description: `[MCP ${server.name}] ${tool.description || tool.name}`,
          inputSchema: asObjectSchema(tool.inputSchema),
        }));
      } catch {
        return [];
      }
    }),
  );
  return listed.flat().slice(0, 80);
}

export async function callMcpTool(
  dataDir: string,
  call: string,
  args: Record<string, unknown>,
  catalog: McpToolRef[] = [],
  home = homedir(),
): Promise<{ text: string; isError: boolean }> {
  const ref =
    catalog.find((item) => item.callName === call) || parseCallName(call);
  if (!ref) return { text: `unknown mcp tool: ${call}`, isError: true };
  const server = listActiveMcp(dataDir, home).find(
    (item) => item.name === ref.server,
  );
  if (!server) return { text: `mcp server not connected: ${ref.server}`, isError: true };
  try {
    const session = await sessionFor(server);
    return await session.callTool(ref.tool, args);
  } catch (error) {
    dropSession(server.name);
    return {
      text: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

export function callName(server: string, tool: string): string {
  const raw = `mcp__${sanitize(server)}__${sanitize(tool)}`;
  return raw.slice(0, 64);
}

function parseCallName(
  call: string,
): { server: string; tool: string; callName: string } | null {
  if (!call.startsWith("mcp__")) return null;
  const rest = call.slice("mcp__".length);
  const idx = rest.indexOf("__");
  if (idx <= 0) return null;
  return {
    server: rest.slice(0, idx),
    tool: rest.slice(idx + 2),
    callName: call,
  };
}

async function sessionFor(server: McpServer): Promise<McpSession> {
  const hit = sessions.get(server.name);
  if (hit) return hit;
  const session = new McpSession(server.launch);
  try {
    await session.ensure();
  } catch (error) {
    session.close();
    throw error;
  }
  sessions.set(server.name, session);
  return session;
}

function dropSession(name: string): void {
  const hit = sessions.get(name);
  if (!hit) return;
  sessions.delete(name);
  hit.close();
}

export function closeMcpSessions(): void {
  for (const name of [...sessions.keys()]) dropSession(name);
}

function asObjectSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (schema && schema.type === "object") return schema;
  return { type: "object", properties: {} };
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeMap(raw: Record<string, unknown>): Record<string, McpLaunch> {
  const out: Record<string, McpLaunch> = {};
  for (const [name, value] of Object.entries(raw)) {
    const launch = asLaunch(value);
    if (launch) out[sanitize(name) || name] = launch;
  }
  return out;
}

function asLaunch(value: unknown): McpLaunch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const command = typeof rec.command === "string" ? rec.command.trim() : "";
  const url = typeof rec.url === "string" ? rec.url.trim() : "";
  const args = Array.isArray(rec.args)
    ? rec.args.filter((item): item is string => typeof item === "string")
    : [];
  const env =
    rec.env && typeof rec.env === "object" && !Array.isArray(rec.env)
      ? Object.fromEntries(
          Object.entries(rec.env as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined;
  const cwd = typeof rec.cwd === "string" ? rec.cwd : undefined;
  if (!command && !url) return null;
  return { command, args, env, cwd, url: url || undefined };
}

function readJsonMcp(file: string, host: string): McpServer[] {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    return Object.entries(normalizeMap(parsed.mcpServers || {})).map(
      ([name, launch]) => ({
        id: `${host.toLowerCase()}:${name}`,
        name,
        source: "host" as const,
        host,
        launch,
        enabled: false,
      }),
    );
  } catch {
    return [];
  }
}

function readClaudeMcp(file: string, host: string): McpServer[] {
  return readJsonMcp(file, host);
}

function readCodexMcp(file: string, host: string): McpServer[] {
  if (!existsSync(file)) return [];
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const blocks = new Map<string, Record<string, string>>();
  let current: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(/^\[mcp_servers\.([^\].]+)\]$/);
    if (header) {
      current = header[1];
      if (!blocks.has(current)) blocks.set(current, {});
      continue;
    }
    const envHeader = line.match(/^\[mcp_servers\.([^\]]+)\.env\]$/);
    if (envHeader) {
      current = `${envHeader[1]}__env`;
      if (!blocks.has(current)) blocks.set(current, {});
      continue;
    }
    if (current && /^[a-zA-Z0-9_]+\s*=/.test(line)) {
      const eq = line.indexOf("=");
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      blocks.get(current)![key] = val;
    }
    if (line.startsWith("[") && !line.startsWith("[mcp_servers.")) current = null;
  }
  const out: McpServer[] = [];
  for (const [name, fields] of blocks) {
    if (name.endsWith("__env")) continue;
    const envBlock = blocks.get(`${name}__env`) || {};
    const command = unquote(fields.command || "");
    const url = unquote(fields.url || "");
    if (!command && !url) continue;
    out.push({
      id: `${host.toLowerCase()}:${name}`,
      name,
      source: "host",
      host,
      launch: {
        command,
        args: parseTomlArray(fields.args || ""),
        env: Object.fromEntries(
          Object.entries(envBlock).map(([key, value]) => [key, unquote(value)]),
        ),
        url: url || undefined,
      },
      enabled: false,
    });
  }
  return out;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const m = trimmed.match(/^"(.*)"$/);
  if (m) return m[1].replace(/\\"/g, '"');
  return trimmed;
}

function parseTomlArray(value: string): string[] {
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  return inner
    .split(",")
    .map((item) => unquote(item.trim()))
    .filter(Boolean);
}
