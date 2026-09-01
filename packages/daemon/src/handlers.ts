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
  pickSkills,
  type ChatReply,
  type GenerateKind,
  type SkillPickInput,
} from "./generate.ts";
import {
  liveTrajectoryEvents,
  promoteSpawnEvent,
  synthesizeTrajectory,
  turnTrajectoryEvents,
  userTrajectoryEvent,
} from "./trajectory.ts";
import { importFromGithub, importFromUrl } from "./skill-import.ts";
import {
  harvestBotMemory,
  harvestChannelMemory,
  mergeQuestMemory,
} from "./memory.ts";
import { listHostSkills, type HostSkill } from "./host-skills.ts";
import {
  CHANNEL_ROSTER_CAP,
  GuildStore,
  StoreError,
  type LiveStep,
  type LiveTurn,
} from "./store.ts";
import { listSpawnRefs } from "./subagent.ts";
import {
  importHostMcp,
  listGuildMcp,
  listHostMcp,
  listMcpToolRefs,
  publicMcpServer,
  removeGuildMcp,
  upsertGuildMcp,
} from "./mcp.ts";
import {
  assignmentFor,
  isBroadcastMention,
  messageMentionIds,
  parseMentionIds,
  sanitizeMentionIds,
} from "./mention.ts";
import { slashNames } from "./slash.ts";
import { toHistoryItem, type HistoryItem } from "./compact.ts";
import type { SkillRef, SubAgentRef, ToolProgress, ToolTrace } from "./tools.ts";
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
  mcpTools?: McpToolRef[] | Promise<McpToolRef[]>;
  onTurnComplete?: (turn: TurnComplete) => void;
  turn?: (input: Parameters<typeof chatReply>[0]) => Promise<ChatReply>;
  /** Bot ids the client already resolved from @mentions. */
  mentions?: string[];
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

/** HTTP surfaces never carry `launch.env` values; see `publicMcpServer`. */
export function listMcpServers(store: GuildStore) {
  return listGuildMcp(store.dataDir).map(publicMcpServer);
}

export function listHostMcpServers() {
  return listHostMcp().map(publicMcpServer);
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
    return publicMcpServer(
      upsertGuildMcp(store.dataDir, input.name, {
        command: input.command || "",
        args: input.args || [],
        env: input.env,
        cwd: input.cwd,
        url: input.url,
      }),
    );
  } catch (error) {
    throw new StoreError(
      400,
      error instanceof Error ? error.message : "invalid mcp server",
    );
  }
}

export function importMcpServer(store: GuildStore, hostId: string) {
  try {
    return publicMcpServer(importHostMcp(store.dataDir, hostId));
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
    portrait?: string | null;
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

const LOOK_HAIR = [
  "jet-black short crop",
  "jet-black long straight hair",
  "copper-red bob with blunt bangs",
  "copper-red messy spikes",
  "indigo long waves",
  "indigo pixie cut",
  "honey-blonde high ponytail",
  "honey-blonde bowl cut",
  "hot-pink messy spikes",
  "hot-pink bob",
  "ash-white curly volume",
  "ash-white long hair",
  "teal-tinted undercut",
  "teal high ponytail",
  "deep-burgundy twin braids",
  "deep-burgundy shag",
];
const LOOK_CLOTH = [
  "sunflower-yellow collared shirt",
  "cobalt hooded jacket",
  "rose cardigan over a cream tee",
  "forest-green knit turtleneck",
  "ivory blouse with a coral scarf",
  "charcoal work vest over a rust tee",
  "lilac haori",
  "orange windbreaker",
  "white lab coat over a black tee",
  "crimson bomber jacket",
  "mint sailor collar",
  "navy peacoat",
  "gold-trimmed teal capelet",
  "checkered red-and-black shirt",
  "pale-blue denim jacket",
  "magenta track jacket",
];
const LOOK_EXTRA = [
  "round wire glasses",
  "small gold hoop earrings",
  "over-ear headphones around the neck",
  "a paintbrush tucked behind one ear",
  "a red hair clip",
  "a thin black choker",
  "a knitted ear warmer",
  "no extra accessories",
];
const LOOK_SKIN = [
  "fair peach human skin",
  "warm tan human skin",
  "light brown human skin",
  "deep brown human skin",
  "golden beige human skin",
];
const LOOK_FACE = [
  "round cheerful face with wide-set eyes",
  "sharp jaw and narrow eyes",
  "soft oval face with thick brows",
  "heart-shaped face and a small nose",
  "square face with a bright closed-mouth smile",
];
const LOOK_RACE = [
  {
    id: "human" as const,
    label: "human",
    prompt:
      "human. Ordinary rounded human ears, fully human anatomy, no fantasy ears.",
  },
  {
    id: "dwarf" as const,
    label: "dwarf",
    prompt:
      "young dwarf. Stout neck, broader cheekbones, a slightly larger nose, thick brows, rounded ears, youthful (not elderly, not bald).",
  },
  {
    id: "elf" as const,
    label: "elf",
    prompt:
      "young elf. Long pointed ears clearly visible, fine features, almond eyes, still youthful.",
  },
  {
    id: "demihuman" as const,
    label: "demihuman",
    prompt:
      "demihuman who is 90% human: a human face and bust with only one subtle tell (tiny pointed ear tips, faint whisker marks, or slightly elongated canines). Not a full animal-person, not a mascot, not extra limbs.",
  },
];

function lookSeed(key: string): number {
  let n = 2166136261;
  for (const ch of key) {
    n ^= ch.charCodeAt(0);
    n = Math.imul(n, 16777619);
  }
  return n >>> 0;
}

export function lookTraits(bot: { name: string; handle: string }): {
  hair: string;
  cloth: string;
  extra: string;
  skin: string;
  face: string;
  race: (typeof LOOK_RACE)[number];
} {
  const n = lookSeed(bot.handle || bot.name || "bot");
  return {
    hair: LOOK_HAIR[n % LOOK_HAIR.length],
    cloth: LOOK_CLOTH[(n >>> 4) % LOOK_CLOTH.length],
    extra: LOOK_EXTRA[(n >>> 8) % LOOK_EXTRA.length],
    skin: LOOK_SKIN[(n >>> 12) % LOOK_SKIN.length],
    face: LOOK_FACE[(n >>> 16) % LOOK_FACE.length],
    race: LOOK_RACE[(n >>> 20) % LOOK_RACE.length],
  };
}

export function lookPrompt(bot: {
  name: string;
  handle: string;
  oneLiner?: string;
}): string {
  const role = bot.oneLiner?.trim() || "keeps a seat in the guild tavern";
  const look = lookTraits(bot);
  return [
    `SNES 16-bit pixel-art bust portrait of ${bot.name} (@${bot.handle}), a unique ${look.race.label} guild adventurer.`,
    `Race (mandatory): ${look.race.prompt}`,
    `Mandatory look: ${look.skin}, ${look.face}, ${look.hair}, wearing a ${look.cloth}, ${look.extra}.`,
    `They ${role}.`,
    "Hair color, outfit, and race are locked; do not default to brown hair or a beige coat.",
    "Natural skin tones only, never green, gray, or monster skin.",
    "Head and shoulders only, facing the camera, chunky 16-bit pixels, limited tavern palette, cream pixel outline.",
    "Animal Crossing crossed with Earthbound, youthful SNES NPC.",
    "Opaque cream or tavern-wood background, no black void, no white photo studio, no checkerboard, no transparency.",
    "Close-up character headshot, no full body, no legs, no floor, no scenery, no photorealism, no 3D render, no text, no watermark.",
  ].join(" ");
}

export async function generateBotLook(
  store: GuildStore,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const bot = store.getBot(id);
  if (!bot) throw new StoreError(404, "bot not found");
  const { generateImage } = await import("./image-gen.ts");
  const result = await generateImage({
    prompt: lookPrompt(bot),
    aspectRatio: "1:1",
    dataDir: store.dataDir,
    env,
  });
  if (result.isError || !result.publicPath) {
    throw new StoreError(502, result.text);
  }
  return store.updateBot(id, { portrait: result.publicPath });
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

export async function pickBotSkills(store: GuildStore, input: SkillPickInput) {
  return pickSkills(input, process.env, store.dataDir);
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

export function createBranch(
  store: GuildStore,
  parentId: string,
  messageId: string,
  name?: string,
) {
  return store.createBranch(parentId, messageId, name);
}

export function deleteChannel(store: GuildStore, id: string) {
  const room = store.getRoom(id);
  if (room?.parentId) {
    throw new StoreError(400, "close the branch instead");
  }
  return store.deleteChannel(id);
}

export async function closeBranch(
  store: GuildStore,
  id: string,
  merge = false,
  env: NodeJS.ProcessEnv = process.env,
) {
  const room = store.getRoom(id);
  if (!room) throw new StoreError(404, "channel not found");
  if (room.kind !== "channel") throw new StoreError(400, "not a channel");
  if (!room.parentId) throw new StoreError(400, "not a branch");
  const parent = store.getRoom(room.parentId);
  if (!parent) throw new StoreError(404, "parent not found");
  if (merge) {
    for (const child of store
      .listChannels()
      .filter((item) => item.parentId === id)) {
      await closeBranch(store, child.id, true, env);
    }
    await mergeQuestMemory({
      store,
      parentId: parent.id,
      childId: id,
      questName: room.name,
      env,
    });
  }
  store.deleteChannel(id);
  return { ok: true as const, id, parentId: parent.id, merged: Boolean(merge) };
}

export function renameChannel(store: GuildStore, id: string, name: string) {
  return store.renameChannel(id, name);
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

export function deleteRoomMessage(
  store: GuildStore,
  roomId: string,
  messageId: string,
) {
  const removed = store.deleteMessage(roomId, messageId);
  return { ok: true, id: removed.id };
}

export function openDm(store: GuildStore, botId: string) {
  return store.openDm(botId);
}

/** A seat may speak twice in one turn so report-back can resume the assigner. */
const HANDOFF_SEAT_CAP = 2;

function handoffTargets(
  store: GuildStore,
  memberIds: string[],
  replies: ChatMessage[],
  asked: string,
  history: HistoryItem[],
  fresh: ChatMessage[],
): { botId: string; fromHandle: string; asked: string; history: HistoryItem[] }[] {
  const bots = store.listBots();
  const handles = bots.map((bot) => bot.handle);
  const spoke = new Map<string, number>();
  for (const row of replies) {
    spoke.set(row.author, (spoke.get(row.author) || 0) + 1);
  }
  const hops: {
    botId: string;
    fromHandle: string;
    asked: string;
    history: HistoryItem[];
  }[] = [];
  const queued = new Set<string>();
  for (const reply of fresh) {
    if (isBroadcastMention(reply.body)) continue;
    const ids = messageMentionIds(reply, bots);
    if (!ids.length) continue;
    const from = bots.find((bot) => bot.id === reply.author);
    const fromHandle = from?.handle || reply.author;
    const hopHistory = history.concat(
      { author: "you", body: asked },
      { author: reply.author, body: reply.body },
    );
    for (const bot of bots) {
      if (!ids.includes(bot.id)) continue;
      if (!memberIds.includes(bot.id)) continue;
      if (bot.id === reply.author) continue;
      if ((spoke.get(bot.id) || 0) >= HANDOFF_SEAT_CAP || queued.has(bot.id)) continue;
      queued.add(bot.id);
      const spec = assignmentFor(reply.body, bot.handle, handles);
      hops.push({
        botId: bot.id,
        fromHandle,
        asked: `（@${fromHandle} 交棒給 @${bot.handle}）\n${spec}`,
        history: hopHistory,
      });
    }
  }
  return hops;
}

function replyBots(
  store: GuildStore,
  memberIds: string[],
  userMessage: { author?: string; body: string; mentions?: string[] },
  extraBotId?: string,
): string[] {
  if (isBroadcastMention(userMessage.body)) return memberIds;
  const mentioned = new Set(
    messageMentionIds(
      { author: userMessage.author || "you", body: userMessage.body, mentions: userMessage.mentions },
      store.listBots(),
    ),
  );
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
  return [
    `（回覆 @${handle}。只做下一句；引言裡的交棒已經發生過，不要再叫別人。）`,
    `> ${preview}`,
    body,
  ].join("\n");
}

const ATTACH_TOKEN = /^\[[A-Za-z]+ #\d+\]$/;
const PREVIEW_RE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;
const PREVIEW_CAP = 100_000;

function parsePreview(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value || value.length > PREVIEW_CAP) return undefined;
  if (!PREVIEW_RE.test(value)) return undefined;
  return value;
}

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
    const preview = parsePreview(rec.preview);
    out.push({
      token,
      title,
      body: body.slice(0, 48_000),
      ...(preview ? { preview } : {}),
    });
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

/** Roster is staffed in the members panel. @handle never pulls a new seat. */
export function inviteMentionedBots(
  store: GuildStore,
  roomId: string,
  _userMessage?: { author?: string; body: string; mentions?: string[] },
): string[] {
  const room = store.getRoom(roomId);
  return room?.memberIds ?? [];
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

function skillLookupKey(value: string): string {
  return value.trim().replace(/^\/+/, "").toLowerCase();
}

/** Skills named with `/slug` this turn, including host leftover not staffed on the bot. */
export function extraTurnSkills(store: GuildStore, text: string): SkillRef[] {
  const names = slashNames(text).slice(0, 8);
  if (!names.length) return [];
  const want = new Set(names);
  const out: SkillRef[] = [];
  const seen = new Set<string>();
  const push = (item: {
    name: string;
    slug: string;
    body: string;
    description?: string;
    path?: string;
  }) => {
    const slug = skillLookupKey(item.slug || item.name);
    const name = skillLookupKey(item.name);
    if (!want.has(slug) && !want.has(name)) return;
    if (seen.has(slug) || seen.has(name)) return;
    seen.add(slug);
    if (name) seen.add(name);
    out.push({
      name: item.name,
      slug: item.slug,
      body: item.body,
      description: item.description,
      path: item.path,
    });
  };
  for (const item of store.listLibrary("skills")) push(item);
  for (const item of listHostSkills()) push(item);
  return out;
}

export function extraTurnSubagents(
  text: string,
  agents: SubAgentRef[],
): SubAgentRef[] {
  const names = new Set(slashNames(text).map((name) => name.toLowerCase()));
  if (!names.size) return [];
  const out: SubAgentRef[] = [];
  const seen = new Set<string>();
  for (const item of agents) {
    const slug = skillLookupKey(item.slug || item.name);
    const name = skillLookupKey(item.name);
    if (!names.has(slug) && !names.has(name)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(item);
  }
  return out;
}

function mergeSkillRefs(staffed: SkillRef[], extra: SkillRef[]): SkillRef[] {
  const seen = new Set(
    staffed.map((item) => skillLookupKey(item.slug || item.name)),
  );
  const out = staffed.slice();
  for (const item of extra) {
    const key = skillLookupKey(item.slug || item.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** POST /channels/:id/messages and DM replies share this turn input. */
export function chatTurnForBot(
  store: GuildStore,
  roomId: string,
  botId: string,
  history: HistoryItem[] = [],
  userMessage = "",
  slashText?: string,
) {
  const detail = store.botDetail(botId);
  const room = store.getRoom(roomId);
  const asked = slashText ?? userMessage;
  const subagents = listSpawnRefs(store.listLibrary("subagents"));
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
    skills: mergeSkillRefs(
      staffedSkills(store, botId),
      extraTurnSkills(store, asked),
    ),
    subagents,
    wantSpawn: extraTurnSubagents(asked, subagents),
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
    return String(
      args.title ||
        args.description ||
        args.profile ||
        args.name ||
        args.task ||
        args.prompt ||
        "",
    );
  }
  if (trace.name === "read_spawn") {
    return String(args.agent_id || args.id || "");
  }
  if (trace.name.startsWith("mcp__")) {
    return JSON.stringify(args).slice(0, 120);
  }
  return String(args.path || "");
}

const LIVE_TRACE_CAP = 100;
const LIVE_TRACE_TEXT = 4_000;
const LIVE_ARGS_CAP = 4_000;

function clipLiveArgs(args: Record<string, unknown>): Record<string, unknown> {
  try {
    const raw = JSON.stringify(args);
    if (!raw || raw.length <= LIVE_ARGS_CAP) return args;
    return { preview: raw.slice(0, LIVE_ARGS_CAP) };
  } catch {
    return {};
  }
}

function clipLiveTraces(traces: ToolTrace[] | undefined): LiveTurn["traces"] {
  return (traces || []).slice(-LIVE_TRACE_CAP).map((tr) => ({
    name: tr.name,
    args: clipLiveArgs(tr.args || {}),
    text: String(tr.text || "").slice(0, LIVE_TRACE_TEXT),
    isError: Boolean(tr.isError),
    running: tr.running,
  }));
}

function publicLiveTurn(live: LiveTurn): LiveTurn {
  return {
    botId: live.botId,
    thinking: live.thinking,
    steps: live.steps,
    startedAt: live.startedAt,
  };
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
  return { botId, thinking, steps, traces: clipLiveTraces(update.traces) };
}

function liveTrajectoryForRoom(
  store: GuildStore,
  roomId: string,
  logged?: { seq: number; botId?: string; kind: string; ts: string }[],
) {
  const liveTurns = store.listLiveRoomTurns(roomId);
  if (!liveTurns.length) return [];
  const events = logged ?? store.listTrajectory(roomId);
  let seq = events.length ? events[events.length - 1].seq + 1 : 0;
  return liveTurns.flatMap((turn) => {
    const started = turn.startedAt ? Date.parse(turn.startedAt) : 0;
    const already = events.some(
      (event) =>
        event.botId === turn.botId &&
        event.kind === "assistant" &&
        (!started || Date.parse(event.ts) >= started),
    );
    if (already) return [];
    return liveTrajectoryEvents({
      botId: turn.botId,
      thinking: turn.thinking,
      traces: turn.traces,
      startedAt: turn.startedAt,
    }).map((draft) => ({ ...draft, seq: seq++, live: true as const }));
  });
}

export function getLiveTurn(store: GuildStore, roomId: string) {
  if (!store.getRoom(roomId)) throw new StoreError(404, "room not found");
  const decorate = (live: LiveTurn): LiveTurn => {
    const shown = publicLiveTurn(live);
    const pending = store.peekSteers(roomId, live.botId);
    if (!pending.length) return shown;
    const steers: LiveStep[] = pending.map((text) => ({
      name: "steer",
      detail: text.replace(/\s+/g, " ").trim().slice(0, 120),
      running: true,
    }));
    const rest = shown.steps.filter((step) => step.name !== "steer");
    return { ...shown, steps: [...steers, ...rest].slice(0, 5) };
  };
  const bots = store.listLiveRoomTurns(roomId).map(decorate);
  const live = bots[bots.length - 1] ?? {
    botId: "",
    thinking: "",
    steps: store.peekSteers(roomId).map((text) => ({
      name: "steer" as const,
      detail: text.replace(/\s+/g, " ").trim().slice(0, 120),
      running: true,
    })),
  };
  return { ...live, bots, traj: liveTrajectoryForRoom(store, roomId) };
}

export function abortLiveTurn(
  store: GuildStore,
  roomId: string,
  botId?: string,
) {
  if (!store.getRoom(roomId)) throw new StoreError(404, "room not found");
  const live = botId
    ? store.getLiveBotTurn(roomId, botId)
    : store.getLiveTurn(roomId);
  const had = store.abortTurn(roomId, botId);
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
  replyTo?: string,
  botId?: string,
) {
  if (!store.getRoom(roomId)) throw new StoreError(404, "room not found");
  const live = store.listLiveRoomTurns(roomId);
  if (!live.length) {
    throw new StoreError(409, "no live turn");
  }
  const packed = parseAttachments(attachments);
  const tokens = packed?.map((att) => att.token).join(" ") || "";
  const text = body.trim() || tokens;
  const parent = parentMessage(store.listMessages(roomId), replyTo);
  const message = store.appendMessage(
    roomId,
    "you",
    text,
    undefined,
    parent?.id,
    packed,
    undefined,
    true,
    botId,
  );
  try {
    store.appendTrajectory(roomId, [
      userTrajectoryEvent(message.id, message.body, message.createdAt),
    ]);
  } catch {
    /* ignore */
  }
  const asked = askedText(store, parent, message);
  if (botId && live.some((turn) => turn.botId === botId)) {
    store.pushSteer(roomId, asked, botId);
  } else {
    for (const turn of live) store.pushSteer(roomId, asked, turn.botId);
  }
  return { message };
}

async function generateReplies(
  store: GuildStore,
  roomId: string,
  memberIds: string[],
  userMessage: { author?: string; body: string; attachments?: ChatAttachment[]; mentions?: string[] },
  history: HistoryItem[],
  onlyBotId?: string,
  env: NodeJS.ProcessEnv = process.env,
  parent?: ChatMessage,
  extras: HandlerExtras = {},
) {
  const extraBotId = hasExplicitSummon(store, userMessage)
    ? undefined
    : followBotId(store, history, parent);
  const asked = askedText(store, parent, userMessage);
  const targets = onlyBotId
    ? [onlyBotId]
    : replyBots(store, memberIds, userMessage, extraBotId);
  const replies: ChatMessage[] = [];
  const harvested: { handle: string; author: string; body: string }[] = [];
  const signal = store.beginTurn(roomId, targets);
  plantLiveTurns(store, roomId, targets, memberIds, onlyBotId);
  const mcpTools = await resolveMcpTools(store, extras);
  const speak = async (
    botId: string,
    turnAsked: string,
    turnHistory: HistoryItem[],
  ) => {
    if (!memberIds.includes(botId)) return;
    if (signal.aborted) return;
    const prev = store.getLiveBotTurn(roomId, botId);
    const startedAt = prev?.startedAt || new Date().toISOString();
    store.dropLastFailedReply(roomId, botId);
    store.setLiveTurn(roomId, {
      botId,
      thinking: prev?.thinking || "",
      steps: prev?.steps || [],
      startedAt,
    });
    let generated;
    try {
      generated = await (extras.turn ?? chatReply)({
        ...chatTurnForBot(
          store,
          roomId,
          botId,
          turnHistory,
          turnAsked,
          userMessage.body,
        ),
        env,
        signal,
        mcpTools,
        onProgress: (update) => {
          const prev = store.getLiveBotTurn(roomId, botId);
          const next = toLiveTurn(botId, update);
          const handoff = (prev?.steps || []).find((step) => step.name === "handoff");
          const pendingSteers = store.peekSteers(roomId, botId).map((text) => ({
            name: "steer" as const,
            detail: text.replace(/\s+/g, " ").trim().slice(0, 120),
            running: true,
          }));
          const keptSteer =
            pendingSteers.length > 0
              ? pendingSteers
              : (prev?.steps || []).filter((step) => step.name === "steer");
          const rest = next.steps.filter(
            (step) => step.name !== "handoff" && step.name !== "steer",
          );
          store.setLiveTurn(roomId, {
            ...next,
            startedAt: prev?.startedAt || startedAt,
            steps: [...(handoff ? [handoff] : []), ...keptSteer, ...rest].slice(0, 5),
          });
        },
        pullSteers: () => store.drainSteers(roomId, botId),
      });
    } catch (err) {
      if (isAbortError(err) || signal.aborted) return;
      throw err;
    }
    const usage = { ...(generated.usage || {}), startedAt };
    const hopMentions = parseMentionIds(
      generated.body,
      store.listBots(),
      "bot",
    ).filter((id) => id !== botId);
    const reply = store.appendMessage(
      roomId,
      botId,
      generated.body,
      generated.parts,
      undefined,
      undefined,
      usage,
      undefined,
      undefined,
      hopMentions,
    );
    store.dropLiveBotTurn(roomId, botId);
    recordTurn(store, roomId, botId, generated, reply);
    replies.push(reply);
    extras.onTurnComplete?.({
      roomId,
      botId,
      userText: turnAsked,
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
          userMessage: turnAsked,
          reply: generated.body,
          env,
          prefer: store.getBot(botId)?.model ?? null,
        }).catch(() => {});
      }
    }
  };
  try {
    const handleList = store.listBots().map((bot) => bot.handle);
    await Promise.all(
      targets.map((botId) => {
        const handle = store.getBot(botId)?.handle || "";
        const body = assignmentFor(userMessage.body, handle, handleList);
        const turnAsked = askedText(store, parent, {
          body,
          attachments: userMessage.attachments,
        });
        return speak(botId, turnAsked, history);
      }),
    );
    let seen = 0;
    for (let wave = 0; wave < CHANNEL_ROSTER_CAP && !signal.aborted; wave++) {
      const fresh = replies.slice(seen);
      seen = replies.length;
      const hops = handoffTargets(store, memberIds, replies, asked, history, fresh);
      if (!hops.length) break;
      const hopAt = new Date().toISOString();
      for (const hop of hops) {
        store.adoptTurn(roomId, hop.botId, signal);
        store.setLiveTurn(roomId, {
          botId: hop.botId,
          thinking: "",
          steps: [
            {
              name: "handoff",
              detail: `@${hop.fromHandle}`,
              running: true,
            },
          ],
          startedAt: hopAt,
        });
      }
      await Promise.all(
        hops.map((hop) => speak(hop.botId, hop.asked, hop.history)),
      );
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
    store.endTurn(roomId, signal);
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
  const base = logged.length
    ? { source: "log" as const, events: logged }
    : {
        source: "derived" as const,
        events: synthesizeTrajectory(store.listMessages(roomId)),
      };
  const extra = liveTrajectoryForRoom(store, roomId, base.events);
  const open = store.listLiveRoomTurns(roomId).some((turn) => {
    const started = turn.startedAt ? Date.parse(turn.startedAt) : 0;
    return !base.events.some(
      (event) =>
        event.botId === turn.botId &&
        event.kind === "assistant" &&
        (!started || Date.parse(event.ts) >= started),
    );
  });
  return {
    ...base,
    events: base.events.map(promoteSpawnEvent).concat(extra),
    live: extra.length > 0 || open,
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

function lastBotSpeaker(
  store: GuildStore,
  messages: { author: string }[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const author = messages[i].author;
    if (author && author !== "you" && store.getBot(author)) return author;
  }
  return undefined;
}

function plantLiveTurns(
  store: GuildStore,
  roomId: string,
  botIds: string[],
  memberIds: string[],
  onlyBotId?: string,
): string {
  const startedAt = new Date().toISOString();
  for (const botId of botIds) {
    if (!botId) continue;
    if (!memberIds.includes(botId)) continue;
    store.dropLastFailedReply(roomId, botId);
    store.setLiveTurn(roomId, {
      botId,
      thinking: "",
      steps: [],
      startedAt,
    });
  }
  return startedAt;
}

async function resolveMcpTools(
  store: GuildStore,
  extras: HandlerExtras,
): Promise<McpToolRef[]> {
  if (extras.mcp === false) return [];
  if (extras.mcpTools !== undefined) return extras.mcpTools;
  return listMcpToolRefs(store.dataDir);
}

function followBotId(
  store: GuildStore,
  messages: { author: string }[],
  parent?: ChatMessage,
): string | undefined {
  if (parent && parent.author !== "you" && store.getBot(parent.author)) {
    return parent.author;
  }
  return lastBotSpeaker(store, messages);
}

/** Reply-to-a-bot locks that seat. Client assigneeId cannot steal it unless the new text @mentions someone. */
function exclusiveReplyBot(
  store: GuildStore,
  userMessage: { author?: string; body: string; mentions?: string[] },
  parent: ChatMessage | undefined,
  assignee?: string,
): string | undefined {
  if (hasExplicitSummon(store, userMessage)) return assignee || undefined;
  if (parent && parent.author !== "you" && store.getBot(parent.author)) {
    return parent.author;
  }
  return assignee || undefined;
}

function hasExplicitSummon(
  store: GuildStore,
  userMessage: { author?: string; body: string; mentions?: string[] },
): boolean {
  if (isBroadcastMention(userMessage.body)) return true;
  return (
    messageMentionIds(
      {
        author: userMessage.author || "you",
        body: userMessage.body,
        mentions: userMessage.mentions,
      },
      store.listBots(),
    ).length > 0
  );
}

function includeFollowBot(
  _store: GuildStore,
  _roomId: string,
  memberIds: string[],
  follow?: string,
): string[] {
  if (!follow || memberIds.includes(follow)) return memberIds;
  return memberIds;
}

function inviteAssignee(
  store: GuildStore,
  roomId: string,
  assigneeId: string,
): string[] {
  const room = store.getRoom(roomId);
  if (!room) return [];
  if (room.kind !== "channel") return room.memberIds;
  if (!store.getBot(assigneeId)) {
    throw new StoreError(400, "assignee does not exist");
  }
  return room.memberIds;
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
  const bots = store.listBots();
  const mentions =
    extras.mentions !== undefined
      ? sanitizeMentionIds(extras.mentions, bots)
      : parseMentionIds(text, bots, "user");
  const message = store.appendMessage(
    roomId,
    "you",
    text,
    undefined,
    parent ? parent.id : undefined,
    packed,
    undefined,
    undefined,
    undefined,
    mentions,
  );
  try {
    store.appendTrajectory(roomId, [
      userTrajectoryEvent(message.id, message.body, message.createdAt),
    ]);
  } catch {
    /* ignore */
  }
  const history = previous.map(toHistoryItem);
  const assignee = assigneeId?.trim();
  const only = exclusiveReplyBot(store, message, parent, assignee);
  let memberIds = only
    ? inviteAssignee(store, roomId, only)
    : inviteMentionedBots(store, roomId, message);
  if (!only && !hasExplicitSummon(store, message)) {
    memberIds = includeFollowBot(
      store,
      roomId,
      memberIds,
      followBotId(store, previous, parent),
    );
  }
  const replies = await generateReplies(
    store,
    roomId,
    memberIds,
    message,
    history,
    only || undefined,
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
    const bots = store.listBots();
    const mentions =
      extras.mentions !== undefined
        ? sanitizeMentionIds(extras.mentions, bots)
        : undefined;
    const message =
      typeof body === "string" && body.trim()
        ? store.updateMessage(roomId, messageId, body, mentions)
        : current;
    store.truncateAfter(roomId, messageId);
    const kept = store.listMessages(roomId);
    const history = kept.slice(0, -1).map(toHistoryItem);
    const parent = parentMessage(kept.slice(0, -1), message.replyTo);
    const assignee = assigneeId?.trim();
    const only = exclusiveReplyBot(store, message, parent, assignee);
    let memberIds = only
      ? inviteAssignee(store, roomId, only)
      : inviteMentionedBots(store, roomId, message);
    if (!only && !hasExplicitSummon(store, message)) {
      memberIds = includeFollowBot(
        store,
        roomId,
        memberIds,
        followBotId(store, kept.slice(0, -1), parent),
      );
    }
    const replies = await generateReplies(
      store,
      roomId,
      memberIds,
      message,
      history,
      only || undefined,
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
  const history = messages.slice(0, userIndex).map(toHistoryItem);
  const startedAt = new Date().toISOString();
  const signal = store.beginTurn(roomId, [current.author]);
  store.setLiveTurn(roomId, {
    botId: current.author,
    thinking: "",
    steps: [],
    startedAt,
  });
  const mcpTools = await resolveMcpTools(store, extras);
  let generated;
  try {
    generated = await (extras.turn ?? chatReply)({
      ...chatTurnForBot(
        store,
        roomId,
        current.author,
        history,
        userMessage.body,
        userMessage.body,
      ),
      env,
      signal,
      mcpTools,
      onProgress: (update) => {
        const prev = store.getLiveBotTurn(roomId, current.author);
        store.setLiveTurn(roomId, {
          ...toLiveTurn(current.author, update),
          startedAt: prev?.startedAt || startedAt,
        });
      },
      pullSteers: () => store.drainSteers(roomId, current.author),
    });
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      return { message: userMessage, replies: [] };
    }
    throw err;
  } finally {
    store.endTurn(roomId, signal);
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

export {
  publicModels,
  mergeModelsFile,
  refreshOpenCodeFreeCatalog,
  refreshReasoningCatalog,
} from "./llm.ts";
