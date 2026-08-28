import type {
  BenchListing,
  ChatAttachment,
  ChatMessage,
  HealthResponse,
  LibraryKind,
  ModelRef,
} from "@guild/protocol";
import {
  buildChatSystem,
  chatReply,
  generateMarkdown,
  localGenerate,
  type ChatReply,
  type GenerateKind,
} from "./generate.ts";
import {
  synthesizeTrajectory,
  turnTrajectoryEvents,
  userTrajectoryEvent,
} from "./trajectory.ts";
import { importFromGithub, importFromUrl } from "./skill-import.ts";
import { harvestBotMemory, harvestChannelMemory } from "./memory.ts";
import { listHostSkills, type HostSkill } from "./host-skills.ts";
import { GuildStore, StoreError, type LiveStep, type LiveTurn } from "./store.ts";
import { listSpawnRefs } from "./subagent.ts";
import {
  importHostMcp,
  listGuildMcp,
  listHostMcp,
  removeGuildMcp,
  upsertGuildMcp,
} from "./mcp.ts";
import { isBroadcastMention, summonedHandles } from "./mention.ts";
import type { SkillRef, ToolProgress, ToolTrace } from "./tools.ts";
import type { McpToolRef } from "./mcp.ts";

export type TurnComplete = {
  roomId: string;
  botId: string;
  userText: string;
  reply: string;
};

export type HandlerExtras = {
  mcp?: boolean;
  oauth?: boolean;
  harvest?: boolean;
  mcpTools?: McpToolRef[];
  onTurnComplete?: (turn: TurnComplete) => void;
  turn?: (input: Parameters<typeof chatReply>[0]) => Promise<ChatReply>;
};

export function healthPayload(): HealthResponse {
  return {
    status: "ok",
    ready: true,
    service: "guildd",
  };
}

export function listBench(store: GuildStore): BenchListing {
  return store.listBots();
}

export function listLibrary(store: GuildStore, kind: LibraryKind) {
  return store.listLibrary(kind);
}

export function listMcpServers(store: GuildStore) {
  return listGuildMcp(store.dataDir);
}

export function listHostMcpServers() {
  return listHostMcp();
}

export function createMcpServer(
  store: GuildStore,
  input: {
    name: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
  },
) {
  try {
    return upsertGuildMcp(store.dataDir, input.name, {
      command: input.command || "",
      args: input.args || [],
      env: input.env,
      cwd: input.cwd,
      url: input.url,
    });
  } catch (error) {
    throw new StoreError(
      400,
      error instanceof Error ? error.message : "invalid mcp server",
    );
  }
}

export function importMcpServer(store: GuildStore, hostId: string) {
  try {
    return importHostMcp(store.dataDir, hostId);
  } catch (error) {
    throw new StoreError(
      404,
      error instanceof Error ? error.message : "host mcp not found",
    );
  }
}

export function deleteMcpServer(store: GuildStore, name: string) {
  try {
    return removeGuildMcp(store.dataDir, name);
  } catch (error) {
    throw new StoreError(
      404,
      error instanceof Error ? error.message : "mcp server not found",
    );
  }
}

export function createLibraryItem(
  store: GuildStore,
  kind: LibraryKind,
  input: { name: string; body?: string; slug?: string; description?: string },
) {
  return store.createLibrary(kind, input);
}

type MarkdownDraft = { name: string; body: string };

function existingSkillForHost(store: GuildStore, host: HostSkill) {
  const skills = store.listLibrary("skills");
  const slug = host.slug.toLowerCase();
  const name = host.name.toLowerCase();
  return (
    skills.find((item) => item.slug.toLowerCase() === slug) ||
    skills.find((item) => item.name.toLowerCase() === name) ||
    null
  );
}

/** Guild UUIDs, or `host:codex:…` ids from the bar picker. Host ids import once. */
export function resolveStaffSkillIds(
  store: GuildStore,
  skillIds: string[],
  hosts?: HostSkill[],
): string[] {
  const hostList = hosts ?? listHostSkills();
  const byId = new Map(hostList.map((item) => [item.id, item]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of skillIds) {
    const id = String(raw || "").trim();
    if (!id) continue;
    let guildId: string;
    if (id.startsWith("host:")) {
      const host = byId.get(id);
      if (!host) throw new StoreError(400, `skillId does not exist: ${id}`);
      const existing = existingSkillForHost(store, host);
      guildId = existing
        ? existing.id
        : store.createLibrary("skills", {
            name: host.name,
            body: host.body,
            description: host.description,
            slug: host.slug,
            tags: host.tags,
          }).id;
    } else {
      if (!store.getLibrary("skills", id)) {
        throw new StoreError(400, `skillId does not exist: ${id}`);
      }
      guildId = id;
    }
    if (seen.has(guildId)) continue;
    seen.add(guildId);
    out.push(guildId);
  }
  return out;
}

export function createBot(
  store: GuildStore,
  input: {
    name: string;
    handle: string;
    oneLiner?: string;
    soulId?: string;
    agentTemplateId?: string;
    defaultPositionId?: string;
    soul?: MarkdownDraft;
    agent?: MarkdownDraft;
    position?: MarkdownDraft;
    skillIds?: string[];
    skillId?: string;
  },
  hosts?: HostSkill[],
) {
  const raw = input.skillIds?.length
    ? input.skillIds
    : input.skillId
      ? [input.skillId]
      : [];
  return store.createBot({
    name: input.name,
    handle: input.handle,
    oneLiner: input.oneLiner,
    soulId: input.soulId,
    agentTemplateId: input.agentTemplateId,
    defaultPositionId: input.defaultPositionId,
    soul: input.soul,
    agent: input.agent,
    position: input.position,
    skillIds: resolveStaffSkillIds(store, raw, hosts),
  });
}

export function getBotDetail(store: GuildStore, id: string) {
  return store.botDetail(id);
}

export function updateBot(
  store: GuildStore,
  id: string,
  input: {
    name?: string;
    handle?: string;
    oneLiner?: string;
    skillIds?: string[];
    soul?: MarkdownDraft;
    agent?: MarkdownDraft;
    position?: MarkdownDraft;
    model?: ModelRef | null;
  },
  hosts?: HostSkill[],
) {
  const skillIds = input.skillIds
    ? resolveStaffSkillIds(store, input.skillIds, hosts)
    : undefined;
  return store.updateBot(id, { ...input, skillIds });
}

export async function importSkills(
  store: GuildStore,
  input: { source: string; url?: string; repo?: string },
  fetchImpl: typeof fetch = fetch,
) {
  const source = input.source.trim();
  const drafts =
    source === "github"
      ? await importFromGithub(input.repo ?? input.url ?? "", fetchImpl)
      : source === "url"
        ? await importFromUrl(input.url ?? "", fetchImpl)
        : (() => {
            throw new StoreError(400, "source must be url or github");
          })();
  return drafts.map((draft) =>
    store.createLibrary("skills", {
      name: draft.name,
      body: draft.body,
      description: draft.description,
      slug: draft.slug,
    }),
  );
}

export async function generateKind(
  store: GuildStore,
  kind: string,
  prompt: string,
) {
  if (
    kind !== "soul" &&
    kind !== "agent" &&
    kind !== "position" &&
    kind !== "skill" &&
    kind !== "subagent"
  ) {
    throw new StoreError(400, "kind must be soul, agent, position, skill, or subagent");
  }
  return generateMarkdown(kind as GenerateKind, prompt, process.env, store.dataDir);
}

function byUpdatedAtDesc<T extends { updatedAt?: string }>(a: T, b: T): number {
  const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
  const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
  const na = Number.isFinite(ta) ? ta : 0;
  const nb = Number.isFinite(tb) ? tb : 0;
  return nb - na;
}

export function workspace(store: GuildStore) {
  const bots = store.listBots();
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const channels = store.listChannels().map((room) => {
    const last = store.lastMessagePreview(room.id);
    return {
      ...room,
      members: room.memberIds
        .map((id) => byId.get(id))
        .filter((bot): bot is NonNullable<typeof bot> => Boolean(bot)),
      updatedAt: last?.createdAt,
      lastMessage: last ?? null,
    };
  });
  const listed = bots.map((bot) => {
    const last = store.lastMessagePreview(`dm-${bot.id}`);
    return {
      ...bot,
      updatedAt: last?.createdAt,
      lastMessage: last ?? null,
    };
  });
  channels.sort(byUpdatedAtDesc);
  listed.sort(byUpdatedAtDesc);
  const live = store.listLiveTurns().flatMap(({ roomId, turn }) => {
    if (!turn.botId) return [];
    const room = store.getRoom(roomId);
    if (!room) return [];
    const id = room.kind === "dm" ? roomId.replace(/^dm-/, "") : roomId;
    return [
      {
        kind: room.kind,
        id,
        botId: turn.botId,
        startedAt: turn.startedAt || "",
        thinking: turn.thinking,
        steps: turn.steps,
      },
    ];
  });
  return { channels, bots: listed, live };
}

export function createChannel(store: GuildStore, name: string) {
  return store.createChannel(name);
}

export function deleteChannel(store: GuildStore, id: string) {
  return store.deleteChannel(id);
}

export function deleteBot(store: GuildStore, id: string) {
  return store.deleteBot(id);
}

export function addChannelMember(
  store: GuildStore,
  roomId: string,
  botId: string,
) {
  return store.addMember(roomId, botId);
}

export function removeChannelMember(
  store: GuildStore,
  roomId: string,
  botId: string,
) {
  return store.removeMember(roomId, botId);
}

export function listRoomMessages(store: GuildStore, roomId: string) {
  return store.listMessages(roomId);
}

export function openDm(store: GuildStore, botId: string) {
  return store.openDm(botId);
}

function replyBots(
  store: GuildStore,
  memberIds: string[],
  userText: string,
  extraBotId?: string,
): string[] {
  if (isBroadcastMention(userText)) return memberIds;
  const bots = store.listBots();
  const names = summonedHandles(
    userText,
    bots.map((bot) => bot.handle),
  );
  const mentioned = new Set<string>();
  for (const bot of bots) {
    if (names.includes(bot.handle.toLowerCase())) mentioned.add(bot.id);
  }
  if (mentioned.size > 0) {
    return memberIds.filter((id) => mentioned.has(id));
  }
  if (extraBotId) return memberIds.filter((id) => id === extraBotId);
  if (memberIds.length === 1) return memberIds;
  return [];
}

function turnUserMessage(
  store: GuildStore,
  parent: ChatMessage | undefined,
  body: string,
): string {
  if (!parent || parent.author === "you") return body;
  const handle =
    store.listBots().find((bot) => bot.id === parent.author)?.handle ||
    parent.author;
  const preview = parent.body.replace(/\s+/g, " ").trim().slice(0, 240);
  return `（回覆 @${handle}：${preview}）\n${body}`;
}

const ATTACH_TOKEN = /^\[[A-Za-z]+ #\d+\]$/;

export function parseAttachments(raw: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ChatAttachment[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const token = typeof rec.token === "string" ? rec.token.trim() : "";
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    const body = typeof rec.body === "string" ? rec.body : "";
    if (!ATTACH_TOKEN.test(token) || !title) continue;
    out.push({ token, title, body: body.slice(0, 48_000) });
  }
  return out.length ? out : undefined;
}

function askedText(
  store: GuildStore,
  parent: ChatMessage | undefined,
  userMessage: { body: string; attachments?: ChatAttachment[] },
): string {
  const asked = turnUserMessage(store, parent, userMessage.body);
  const atts = userMessage.attachments;
  if (!atts?.length) return asked;
  const legend = atts
    .map((att) => `${att.token} ${att.title}\n${att.body}`.trim())
    .join("\n\n");
  return `附件：\n${legend}\n\n${asked}`;
}

/** @handle of a bot not in this channel adds them, then they can reply. */
export function inviteMentionedBots(
  store: GuildStore,
  roomId: string,
  userText: string,
): string[] {
  const room = store.getRoom(roomId);
  if (!room) return [];
  if (room.kind !== "channel") return room.memberIds;
  if (isBroadcastMention(userText)) return room.memberIds;
  const names = summonedHandles(
    userText,
    store.listBots().map((bot) => bot.handle),
  );
  let memberIds = room.memberIds;
  for (const bot of store.listBots()) {
    if (!names.includes(bot.handle.toLowerCase())) continue;
    if (memberIds.includes(bot.id)) continue;
    store.addMember(roomId, bot.id);
    memberIds = [...memberIds, bot.id];
  }
  return memberIds;
}

export function channelMarkdownForRoom(
  store: GuildStore,
  roomId: string,
): string {
  const room = store.getRoom(roomId);
  if (!room || room.kind !== "channel") return "";
  return store.readChannelMd(roomId);
}

export function getChannelMd(store: GuildStore, roomId: string) {
  return { body: store.readChannelMd(roomId) };
}

export function getBotMemory(store: GuildStore, botId: string) {
  return { body: store.readBotMemory(botId) };
}

export function setBotMemory(store: GuildStore, botId: string, body: string) {
  return { body: store.writeBotMemory(botId, body) };
}

export function getChannelMemory(store: GuildStore, roomId: string) {
  return { body: store.readChannelMemory(roomId) };
}

export function setChannelMemory(
  store: GuildStore,
  roomId: string,
  body: string,
) {
  return { body: store.writeChannelMemory(roomId, body) };
}

export function setChannelMd(
  store: GuildStore,
  roomId: string,
  body: string,
) {
  return { body: store.writeChannelMd(roomId, body) };
}

function staffedSkills(store: GuildStore, botId: string): SkillRef[] {
  const detail = store.botDetail(botId);
  return (detail.skillIds ?? [])
    .map((id) => store.getLibrary("skills", id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({
      name: item.name,
      slug: item.slug,
      body: item.body,
      description: item.description,
    }));
}

/** POST /channels/:id/messages and DM replies share this turn input. */
export function chatTurnForBot(
  store: GuildStore,
  roomId: string,
  botId: string,
  history: { id?: string; author: string; body: string }[] = [],
  userMessage = "",
) {
  const detail = store.botDetail(botId);
  const room = store.getRoom(roomId);
  return {
    botName: detail.name,
    handle: detail.handle,
    soul: detail.soul?.body ?? "",
    agent: detail.agent?.body ?? "",
    position: detail.position?.body ?? "",
    history,
    userMessage,
    dataDir: store.dataDir,
    model: detail.model ?? null,
    skills: staffedSkills(store, botId),
    subagents: listSpawnRefs(store.listLibrary("subagents")),
    channelMd: channelMarkdownForRoom(store, roomId),
    botMemory: store.readBotMemory(botId),
    channelMemory:
      room?.kind === "channel" ? store.readChannelMemory(roomId) : "",
    compact: store.readCompact(roomId),
    onCompact: (checkpoint) => store.writeCompact(roomId, checkpoint),
  };
}

export function chatTurnSystem(
  store: GuildStore,
  roomId: string,
  botId: string,
): string {
  return buildChatSystem(chatTurnForBot(store, roomId, botId));
}

function liveDetail(trace: ToolTrace): string {
  const args = trace.args || {};
  if (trace.name === "run") {
    return String(args.description || args.command || "")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (trace.name === "skill") return String(args.name || "");
  if (trace.name === "image_gen") return String(args.prompt || "");
  if (trace.name === "spawn") {
    return String(args.description || args.name || args.prompt || "");
  }
  if (trace.name.startsWith("mcp__")) {
    return JSON.stringify(args).slice(0, 120);
  }
  return String(args.path || "");
}

export function toLiveTurn(botId: string, update: ToolProgress): LiveTurn {
  const thinking = (update.thinking || "").trim();
  const tools: LiveStep[] = (update.traces || []).map((tr) => ({
    name: tr.name,
    detail: liveDetail(tr).slice(0, 120),
    running: tr.running,
  }));
  const steps: LiveStep[] = [];
  if (thinking) {
    steps.push({
      name: "think",
      detail: thinking.split(/\n/)[0].replace(/\s+/g, " ").trim().slice(0, 120),
    });
  }
  steps.push(...tools.slice(thinking ? -4 : -5));
  return { botId, thinking, steps };
}

export function getLiveTurn(store: GuildStore, roomId: string): LiveTurn {
  if (!store.getRoom(roomId)) throw new StoreError(404, "room not found");
  const live = store.getLiveTurn(roomId) ?? { botId: "", thinking: "", steps: [] };
  const pending = store.peekSteers(roomId);
  if (!pending.length) return live;
  const steers: LiveStep[] = pending.map((text) => ({
    name: "steer",
    detail: text.replace(/\s+/g, " ").trim().slice(0, 120),
    running: true,
  }));
  const rest = live.steps.filter((step) => step.name !== "steer");
  return { ...live, steps: [...steers, ...rest].slice(0, 5) };
}

export function abortLiveTurn(store: GuildStore, roomId: string) {
  if (!store.getRoom(roomId)) throw new StoreError(404, "room not found");
  const live = store.getLiveTurn(roomId);
  const had = store.abortTurn(roomId);
  if (!live && !had) throw new StoreError(409, "no live turn");
  return { ok: true };
}

function isAbortError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "AbortError",
  );
}

export function steerUserMessage(
  store: GuildStore,
  roomId: string,
  body: string,
  attachments?: ChatAttachment[],
) {
  if (!store.getRoom(roomId)) throw new StoreError(404, "room not found");
  if (!store.getLiveTurn(roomId)) {
    throw new StoreError(409, "no live turn");
  }
  const packed = parseAttachments(attachments);
  const tokens = packed?.map((att) => att.token).join(" ") || "";
  const text = body.trim() || tokens;
  const message = store.appendMessage(
    roomId,
    "you",
    text,
    undefined,
    undefined,
    packed,
    undefined,
    true,
  );
  try {
    store.appendTrajectory(roomId, [
      userTrajectoryEvent(message.id, message.body, message.createdAt),
    ]);
  } catch {
    /* ignore */
  }
  store.pushSteer(roomId, askedText(store, undefined, message));
  return { message };
}

async function generateReplies(
  store: GuildStore,
  roomId: string,
  memberIds: string[],
  userMessage: { body: string; attachments?: ChatAttachment[] },
  history: { id?: string; author: string; body: string }[],
  onlyBotId?: string,
  env: NodeJS.ProcessEnv = process.env,
  parent?: ChatMessage,
  extras: HandlerExtras = {},
) {
  const extraBotId =
    parent && parent.author !== "you" ? parent.author : undefined;
  const asked = askedText(store, parent, userMessage);
  const targets = onlyBotId
    ? [onlyBotId]
    : replyBots(store, memberIds, userMessage.body, extraBotId);
  const replies = [];
  const harvested: { handle: string; author: string; body: string }[] = [];
  const signal = store.beginTurn(roomId);
  try {
  for (const botId of targets) {
    if (!memberIds.includes(botId) && !onlyBotId) continue;
    if (signal.aborted) break;
    const startedAt = new Date().toISOString();
    store.setLiveTurn(roomId, { botId, thinking: "", steps: [], startedAt });
    let generated;
    try {
      generated = await (extras.turn ?? chatReply)({
        ...chatTurnForBot(store, roomId, botId, history, asked),
        env,
        signal,
        mcpTools: extras.mcp === false ? [] : extras.mcpTools,
        onProgress: (update) => {
          const prev = store.getLiveTurn(roomId);
          store.setLiveTurn(roomId, {
            ...toLiveTurn(botId, update),
            startedAt: prev?.startedAt || startedAt,
          });
        },
        pullSteers: () => store.drainSteers(roomId),
      });
    } catch (err) {
      if (isAbortError(err) || signal.aborted) break;
      throw err;
    }
    const usage = { ...(generated.usage || {}), startedAt };
    const reply = store.appendMessage(
      roomId,
      botId,
      generated.body,
      generated.parts,
      undefined,
      undefined,
      usage,
    );
    recordTurn(store, roomId, botId, generated, reply);
    replies.push(reply);
    extras.onTurnComplete?.({
      roomId,
      botId,
      userText: asked,
      reply: generated.body,
    });
    if (generated.source === "llm") {
      harvested.push({
        handle: store.getBot(botId)?.handle || botId,
        author: botId,
        body: generated.body,
      });
      if (extras.harvest !== false) {
        await harvestBotMemory({
          store,
          botId,
          userMessage: asked,
          reply: generated.body,
          env,
          prefer: store.getBot(botId)?.model ?? null,
        }).catch(() => {});
      }
    }
  }
  const room = store.getRoom(roomId);
  if (room?.kind === "channel" && harvested.length && extras.harvest !== false) {
    await harvestChannelMemory({
      store,
      roomId,
      userMessage: asked,
      replies: harvested,
      env,
      prefer: store.getBot(harvested[0].author)?.model ?? null,
    }).catch(() => {});
  }
  return replies;
  } finally {
    store.endTurn(roomId);
  }
}

function recordTurn(
  store: GuildStore,
  roomId: string,
  botId: string,
  generated: ChatReply,
  reply: ChatMessage,
) {
  try {
    store.appendTrajectory(
      roomId,
      turnTrajectoryEvents({
        turnId: reply.id,
        botId,
        ts: reply.createdAt,
        system: generated.system,
        channelMd: channelMarkdownForRoom(store, roomId),
        model: generated.model,
        thinking: generated.thinking,
        traces: generated.traces,
        text: generated.body,
        source: generated.source,
      }),
    );
  } catch {
    /* trajectory must never break chat */
  }
}

export function listRoomTrajectory(store: GuildStore, roomId: string) {
  if (!store.getRoom(roomId)) throw new StoreError(404, "room not found");
  const logged = store.listTrajectory(roomId);
  if (logged.length) return { source: "log" as const, events: logged };
  return {
    source: "derived" as const,
    events: synthesizeTrajectory(store.listMessages(roomId)),
  };
}

function parentMessage(
  messages: ChatMessage[],
  replyTo?: string,
): ChatMessage | undefined {
  const id = replyTo?.trim();
  if (!id) return undefined;
  return messages.find((item) => item.id === id);
}

function inviteAssignee(
  store: GuildStore,
  roomId: string,
  assigneeId: string,
): string[] {
  const room = store.getRoom(roomId);
  if (!room) return [];
  if (room.kind !== "channel") return room.memberIds;
  if (room.memberIds.includes(assigneeId)) return room.memberIds;
  if (!store.getBot(assigneeId)) {
    throw new StoreError(400, "assignee does not exist");
  }
  store.addMember(roomId, assigneeId);
  return [...room.memberIds, assigneeId];
}

export async function postUserMessage(
  store: GuildStore,
  roomId: string,
  body: string,
  env: NodeJS.ProcessEnv = process.env,
  replyTo?: string,
  attachments?: ChatAttachment[],
  assigneeId?: string,
  extras: HandlerExtras = {},
) {
  const room = store.getRoom(roomId);
  if (!room) throw new StoreError(404, "room not found");
  const previous = store.listMessages(roomId);
  const parent = parentMessage(previous, replyTo);
  const packed = parseAttachments(attachments);
  const tokens = packed?.map((att) => att.token).join(" ") || "";
  const text = body.trim() || tokens;
  const message = store.appendMessage(
    roomId,
    "you",
    text,
    undefined,
    parent ? parent.id : undefined,
    packed,
  );
  try {
    store.appendTrajectory(roomId, [
      userTrajectoryEvent(message.id, message.body, message.createdAt),
    ]);
  } catch {
    /* ignore */
  }
  const history = previous.map((item) => ({
    id: item.id,
    author: item.author,
    body: item.body,
  }));
  const assignee = assigneeId?.trim();
  let memberIds = assignee
    ? inviteAssignee(store, roomId, assignee)
    : inviteMentionedBots(store, roomId, message.body);
  if (parent && parent.author !== "you" && !memberIds.includes(parent.author)) {
    try {
      store.addMember(roomId, parent.author);
      memberIds = [...memberIds, parent.author];
    } catch {
      // bot gone, or this room is a DM
    }
  }
  const replies = await generateReplies(
    store,
    roomId,
    memberIds,
    message,
    history,
    assignee || undefined,
    env,
    parent,
    extras,
  );
  return { message, replies };
}

export async function retryMessage(
  store: GuildStore,
  roomId: string,
  messageId: string,
  body?: string,
  env: NodeJS.ProcessEnv = process.env,
  assigneeId?: string,
  extras: HandlerExtras = {},
) {
  const room = store.getRoom(roomId);
  if (!room) throw new StoreError(404, "room not found");
  const messages = store.listMessages(roomId);
  const index = messages.findIndex((item) => item.id === messageId);
  if (index < 0) throw new StoreError(404, "message not found");
  const current = messages[index];

  if (current.author === "you") {
    const message =
      typeof body === "string" && body.trim()
        ? store.updateMessage(roomId, messageId, body)
        : current;
    store.truncateAfter(roomId, messageId);
    const kept = store.listMessages(roomId);
    const history = kept.slice(0, -1).map((item) => ({
      id: item.id,
      author: item.author,
      body: item.body,
    }));
    const parent = parentMessage(kept.slice(0, -1), message.replyTo);
    const assignee = assigneeId?.trim();
    let memberIds = assignee
      ? inviteAssignee(store, roomId, assignee)
      : inviteMentionedBots(store, roomId, message.body);
    if (parent && parent.author !== "you" && !memberIds.includes(parent.author)) {
      try {
        store.addMember(roomId, parent.author);
        memberIds = [...memberIds, parent.author];
      } catch {
        // bot gone, or this room is a DM
      }
    }
    const replies = await generateReplies(
      store,
      roomId,
      memberIds,
      message,
      history,
      assignee || undefined,
      env,
      parent,
      extras,
    );
    return { message, replies };
  }

  let userIndex = index - 1;
  while (userIndex >= 0 && messages[userIndex].author !== "you") userIndex -= 1;
  if (userIndex < 0) throw new StoreError(400, "no user message to retry");
  const userMessage = messages[userIndex];
  const history = messages.slice(0, userIndex).map((item) => ({
    id: item.id,
    author: item.author,
    body: item.body,
  }));
  const startedAt = new Date().toISOString();
  const signal = store.beginTurn(roomId);
  store.setLiveTurn(roomId, {
    botId: current.author,
    thinking: "",
    steps: [],
    startedAt,
  });
  let generated;
  try {
    generated = await (extras.turn ?? chatReply)({
      ...chatTurnForBot(
        store,
        roomId,
        current.author,
        history,
        userMessage.body,
      ),
      env,
      signal,
      mcpTools: extras.mcp === false ? [] : extras.mcpTools,
      onProgress: (update) => {
        const prev = store.getLiveTurn(roomId);
        store.setLiveTurn(roomId, {
          ...toLiveTurn(current.author, update),
          startedAt: prev?.startedAt || startedAt,
        });
      },
      pullSteers: () => store.drainSteers(roomId),
    });
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      return { message: userMessage, replies: [] };
    }
    throw err;
  } finally {
    store.endTurn(roomId);
  }
  const usage = { ...(generated.usage || {}), startedAt };
  const reply = store.replaceMessage(
    roomId,
    messageId,
    generated.body,
    generated.parts,
    usage,
  );
  recordTurn(store, roomId, current.author, generated, reply);
  extras.onTurnComplete?.({
    roomId,
    botId: current.author,
    userText: userMessage.body,
    reply: generated.body,
  });
  if (generated.source === "llm" && extras.harvest !== false) {
    await harvestBotMemory({
      store,
      botId: current.author,
      userMessage: userMessage.body,
      reply: generated.body,
      env,
      prefer: store.getBot(current.author)?.model ?? null,
    }).catch(() => {});
    const roomAfter = store.getRoom(roomId);
    if (roomAfter?.kind === "channel") {
      await harvestChannelMemory({
        store,
        roomId,
        userMessage: userMessage.body,
        replies: [
          {
            handle: store.getBot(current.author)?.handle,
            author: current.author,
            body: generated.body,
          },
        ],
        env,
        prefer: store.getBot(current.author)?.model ?? null,
      }).catch(() => {});
    }
  }
  return { message: userMessage, replies: [reply] };
}

export { StoreError, localGenerate };

export { publicModels, mergeModelsFile } from "./llm.ts";
