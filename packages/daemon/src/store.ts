import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { TrajectoryDraft, TrajectoryEvent } from "./trajectory.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Bot,
  ChatAttachment,
  ChatMessage,
  ChatPart,
  ChatUsage,
  LibraryItem,
  LibraryKind,
  ModelRef,
  Room,
} from "@guild/protocol";
import { DEFAULT_BOTS } from "./catalog/default-bots.ts";
import { CATALOG_SKILLS } from "./catalog/skills.ts";
import { CATALOG_SUBAGENTS } from "./catalog/subagents.ts";
import { parseAgentFile } from "./agent-file.ts";

const MARKDOWN: Record<LibraryKind, string> = {
  souls: "SOUL.md",
  agents: "AGENTS.md",
  skills: "SKILL.md",
  positions: "POSITION.md",
  subagents: "SUBAGENT.toml",
};

const GENERAL_CHANNEL_ID = "channel-general";
const NAV_PREVIEW_CAP = 120;

export function clipNavPreview(body: string): string {
  return String(body || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAV_PREVIEW_CAP);
}

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.GUILD_HOME ?? join(homedir(), ".guild");
}

export type LiveStep = {
  name: string;
  detail: string;
  running?: boolean;
};

export type LiveTurn = {
  botId: string;
  thinking: string;
  steps: LiveStep[];
  startedAt?: string;
};

export class GuildStore {
  private readonly liveTurns = new Map<string, LiveTurn>();
  private readonly pendingSteers = new Map<string, string[]>();
  private readonly turnAborts = new Map<string, AbortController>();

  constructor(readonly dataDir: string) {
    mkdirSync(join(dataDir, "library", "souls"), { recursive: true });
    mkdirSync(join(dataDir, "library", "agents"), { recursive: true });
    mkdirSync(join(dataDir, "library", "skills"), { recursive: true });
    mkdirSync(join(dataDir, "library", "positions"), { recursive: true });
    mkdirSync(join(dataDir, "library", "subagents"), { recursive: true });
    mkdirSync(join(dataDir, "bots"), { recursive: true });
    mkdirSync(join(dataDir, "rooms"), { recursive: true });
    this.seedCatalog();
    this.seedDefaultBots();
    this.ensureGeneralChannel();
  }

  private seedCatalog(): void {
    for (const skill of CATALOG_SKILLS) {
      const item: LibraryItem = {
        id: `catalog-${skill.slug}`,
        slug: skill.slug,
        name: skill.name,
        body: skill.body,
        description: skill.description,
        tags: skill.tags,
        source: "catalog",
        featured: skill.featured,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      this.writeLibraryItem("skills", item);
    }
    for (const agent of CATALOG_SUBAGENTS) {
      const item: LibraryItem = {
        id: `catalog-subagent-${agent.slug}`,
        slug: agent.slug,
        name: agent.name,
        body: agent.body,
        description: agent.description,
        tags: agent.tags,
        source: "catalog",
        featured: agent.featured,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      this.writeLibraryItem("subagents", item);
    }
  }

  private seedDefaultBots(): void {
    const skillBySlug = new Map(
      this.listLibrary("skills").map((item) => [item.slug, item.id]),
    );
    const existingByHandle = new Map(
      this.listBots().map((bot) => [bot.handle, bot]),
    );
    const retired = this.readRetired();
    for (const seed of DEFAULT_BOTS) {
      if (retired.has(seed.handle)) continue;
      const existing = existingByHandle.get(seed.handle);
      if (existing) {
        if (!existing.oneLiner) {
          this.writeBot({ ...existing, oneLiner: seed.oneLiner });
        }
        continue;
      }
      const soulId = `soul-${seed.handle}`;
      const agentId = `agent-${seed.handle}`;
      const positionId = `position-${seed.handle}`;
      if (!this.getLibrary("souls", soulId)) {
        this.writeLibraryItem("souls", {
          id: soulId,
          slug: `soul-${seed.handle}`,
          name: `${seed.name} · Soul`,
          body: seed.soul,
          source: "catalog",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (!this.getLibrary("agents", agentId)) {
        this.writeLibraryItem("agents", {
          id: agentId,
          slug: `agent-${seed.handle}`,
          name: `${seed.name} · Agent`,
          body: seed.agent,
          source: "catalog",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (!this.getLibrary("positions", positionId)) {
        this.writeLibraryItem("positions", {
          id: positionId,
          slug: `position-${seed.handle}`,
          name: seed.name,
          body: seed.position,
          source: "catalog",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      const skillIds = seed.skillSlugs.map((slug) => {
        const id = skillBySlug.get(slug);
        if (!id) throw new Error(`missing catalog skill: ${slug}`);
        return id;
      });
      const bot: Bot = {
        id: `bot-${seed.handle}`,
        handle: seed.handle,
        name: seed.name,
        status: "bench",
        soulId,
        agentTemplateId: agentId,
        skillIds,
        defaultPositionId: positionId,
        oneLiner: seed.oneLiner,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const dir = join(this.dataDir, "bots", bot.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "bot.json"), `${JSON.stringify(bot, null, 2)}\n`);
      writeFileSync(
        join(dir, "IDENTITY.md"),
        `# ${bot.name}\n\nhandle: @${bot.handle}\n\n${seed.oneLiner}\n`,
      );
    }
  }

  listLibrary(kind: LibraryKind): LibraryItem[] {
    const root = join(this.dataDir, "library", kind);
    const ids = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    return ids
      .map((id) => this.readLibraryItem(kind, id))
      .filter((item): item is LibraryItem => item !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getLibrary(kind: LibraryKind, id: string): LibraryItem | null {
    return this.readLibraryItem(kind, id);
  }

  createLibrary(
    kind: LibraryKind,
    input: {
      name: string;
      body?: string;
      slug?: string;
      description?: string;
      tags?: string[];
    },
  ): LibraryItem {
    const name = input.name.trim();
    if (!name) {
      throw new StoreError(400, "name is required");
    }
    const id = randomUUID();
    const slug = uniqueSlug(
      input.slug?.trim() || slugify(name),
      this.listLibrary(kind).map((item) => item.slug),
    );
    let description = input.description;
    let displayName = name;
    const body = input.body ?? "";
    if (kind === "subagents" && !body.trim()) {
      throw new StoreError(400, "subagent TOML is required");
    }
    if (kind === "subagents" && body.trim()) {
      const parsed = parseAgentFile(body, slug);
      if (!description) description = parsed.description;
      if (parsed.name) displayName = parsed.name;
    }
    const item: LibraryItem = {
      id,
      slug,
      name: displayName,
      body,
      description,
      tags: input.tags,
      source: "user",
      createdAt: new Date().toISOString(),
    };
    this.writeLibraryItem(kind, item);
    return item;
  }

  setLiveTurn(roomId: string, turn: LiveTurn): void {
    this.liveTurns.set(roomId, turn);
  }

  clearLiveTurn(roomId: string): void {
    this.liveTurns.delete(roomId);
    this.pendingSteers.delete(roomId);
  }

  getLiveTurn(roomId: string): LiveTurn | null {
    return this.liveTurns.get(roomId) ?? null;
  }

  listLiveTurns(): { roomId: string; turn: LiveTurn }[] {
    return [...this.liveTurns.entries()].map(([roomId, turn]) => ({
      roomId,
      turn,
    }));
  }

  beginTurn(roomId: string): AbortSignal {
    const prev = this.turnAborts.get(roomId);
    if (prev && !prev.signal.aborted) prev.abort();
    const controller = new AbortController();
    this.turnAborts.set(roomId, controller);
    return controller.signal;
  }

  abortTurn(roomId: string): boolean {
    const controller = this.turnAborts.get(roomId);
    this.turnAborts.delete(roomId);
    this.liveTurns.delete(roomId);
    this.pendingSteers.delete(roomId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
      return true;
    }
    return Boolean(controller);
  }

  endTurn(roomId: string): void {
    this.turnAborts.delete(roomId);
    this.clearLiveTurn(roomId);
  }

  pushSteer(roomId: string, text: string): void {
    const body = text.trim();
    if (!body) return;
    const list = this.pendingSteers.get(roomId) ?? [];
    list.push(body);
    this.pendingSteers.set(roomId, list);
  }

  drainSteers(roomId: string): string[] {
    const list = this.pendingSteers.get(roomId) ?? [];
    this.pendingSteers.delete(roomId);
    return list;
  }

  peekSteers(roomId: string): string[] {
    return this.pendingSteers.get(roomId) ?? [];
  }

  listBots(): Bot[] {
    const root = join(this.dataDir, "bots");
    const ids = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    return ids
      .map((id) => this.readBot(id))
      .filter((bot): bot is Bot => bot !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  createBot(input: {
    name: string;
    handle: string;
    oneLiner?: string;
    soulId?: string;
    agentTemplateId?: string;
    defaultPositionId?: string;
    soul?: { name: string; body: string };
    agent?: { name: string; body: string };
    position?: { name: string; body: string };
    skillIds: string[];
    model?: ModelRef | null;
  }): Bot {
    const name = input.name.trim();
    const handle = input.handle.trim().replace(/^@/, "");
    if (!name) throw new StoreError(400, "name is required");
    if (!handle) throw new StoreError(400, "handle is required");
    if (this.listBots().some((bot) => bot.handle === handle)) {
      throw new StoreError(409, `handle already taken: ${handle}`);
    }

    const soulId = this.resolveMarkdownRef("souls", input.soulId, input.soul);
    const agentTemplateId = this.resolveMarkdownRef(
      "agents",
      input.agentTemplateId,
      input.agent,
    );
    const defaultPositionId = this.resolveMarkdownRef(
      "positions",
      input.defaultPositionId,
      input.position,
    );

    if (input.skillIds.length === 0) {
      throw new StoreError(400, "at least one skill is required");
    }
    for (const skillId of input.skillIds) {
      if (!this.getLibrary("skills", skillId)) {
        throw new StoreError(400, `skillId does not exist: ${skillId}`);
      }
    }
    const id = randomUUID();
    const bot: Bot = {
      id,
      handle,
      name,
      status: "bench",
      soulId,
      agentTemplateId,
      skillIds: input.skillIds,
      defaultPositionId,
      oneLiner: input.oneLiner?.trim() || undefined,
      model: input.model ?? null,
      createdAt: new Date().toISOString(),
    };
    this.writeBot(bot);
    this.addMember(GENERAL_CHANNEL_ID, bot.id);
    this.clearRetired(handle);
    return bot;
  }

  deleteBot(id: string): { ok: true; id: string } {
    const bot = this.getBot(id);
    if (!bot) throw new StoreError(404, "bot not found");
    for (const channel of this.listChannels()) {
      if (!channel.memberIds.includes(id)) continue;
      this.writeRoom({
        ...channel,
        memberIds: channel.memberIds.filter((memberId) => memberId !== id),
      });
    }
    const dm = this.getRoom(`dm-${id}`);
    if (dm) this.removeRoomDir(dm.id);
    this.removeBotDir(bot.id);
    this.markRetired(bot.handle);
    return { ok: true, id: bot.id };
  }

  deleteChannel(id: string): { ok: true; id: string } {
    const room = this.getRoom(id);
    if (!room) throw new StoreError(404, "channel not found");
    if (room.kind !== "channel") {
      throw new StoreError(400, "not a channel");
    }
    if (room.id === GENERAL_CHANNEL_ID || room.name === "general") {
      throw new StoreError(400, "cannot delete #general");
    }
    this.removeRoomDir(room.id);
    return { ok: true, id: room.id };
  }

  getBot(id: string): Bot | null {
    return this.readBot(id);
  }

  botDetail(id: string) {
    const bot = this.readBot(id);
    if (!bot) throw new StoreError(404, "bot not found");
    return {
      ...bot,
      soul: this.getLibrary("souls", bot.soulId),
      agent: this.getLibrary("agents", bot.agentTemplateId),
      position: this.getLibrary("positions", bot.defaultPositionId),
    };
  }

  updateBot(
    id: string,
    input: {
      name?: string;
      handle?: string;
      oneLiner?: string;
      skillIds?: string[];
      soul?: { name: string; body: string };
      agent?: { name: string; body: string };
      position?: { name: string; body: string };
      model?: ModelRef | null;
    },
  ): Bot {
    const bot = this.readBot(id);
    if (!bot) throw new StoreError(404, "bot not found");
    const name = input.name?.trim() || bot.name;
    const handle = (input.handle?.trim().replace(/^@/, "") || bot.handle);
    if (
      handle !== bot.handle &&
      this.listBots().some((other) => other.handle === handle)
    ) {
      throw new StoreError(409, `handle already taken: ${handle}`);
    }
    const skillIds = input.skillIds ?? bot.skillIds;
    if (skillIds.length === 0) {
      throw new StoreError(400, "at least one skill is required");
    }
    for (const skillId of skillIds) {
      if (!this.getLibrary("skills", skillId)) {
        throw new StoreError(400, `skillId does not exist: ${skillId}`);
      }
    }
    if (input.soul?.body.trim()) {
      this.patchLibrary("souls", bot.soulId, input.soul);
    }
    if (input.agent?.body.trim()) {
      this.patchLibrary("agents", bot.agentTemplateId, input.agent);
    }
    if (input.position?.body.trim()) {
      this.patchLibrary("positions", bot.defaultPositionId, input.position);
    }
    const next: Bot = {
      ...bot,
      name,
      handle,
      skillIds,
      oneLiner: input.oneLiner?.trim() || bot.oneLiner,
      model: Object.hasOwn(input, "model") ? input.model ?? null : bot.model,
    };
    this.writeBot(next);
    return next;
  }

  private patchLibrary(
    kind: "souls" | "agents" | "positions",
    id: string,
    draft: { name: string; body: string },
  ): void {
    const existing = this.getLibrary(kind, id);
    if (!existing) {
      throw new StoreError(400, `${kind} id does not exist`);
    }
    this.writeLibraryItem(kind, {
      ...existing,
      name: draft.name.trim() || existing.name,
      body: draft.body,
    });
  }

  private writeBot(bot: Bot): void {
    const dir = join(this.dataDir, "bots", bot.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bot.json"), `${JSON.stringify(bot, null, 2)}\n`);
    writeFileSync(
      join(dir, "IDENTITY.md"),
      `# ${bot.name}\n\nhandle: @${bot.handle}\n\n${bot.oneLiner ?? ""}\n`,
    );
  }

  private resolveMarkdownRef(
    kind: "souls" | "agents" | "positions",
    existingId: string | undefined,
    draft: { name: string; body: string } | undefined,
  ): string {
    if (existingId) {
      if (!this.getLibrary(kind, existingId)) {
        throw new StoreError(400, `${kind} id does not exist`);
      }
      return existingId;
    }
    if (draft && draft.body.trim()) {
      const created = this.createLibrary(kind, {
        name: draft.name.trim() || kind,
        body: draft.body,
      });
      return created.id;
    }
    throw new StoreError(400, `${kind} markdown is required`);
  }

  private readLibraryItem(kind: LibraryKind, id: string): LibraryItem | null {
    try {
      const raw = readFileSync(
        join(this.dataDir, "library", kind, id, "item.json"),
        "utf8",
      );
      return JSON.parse(raw) as LibraryItem;
    } catch {
      return null;
    }
  }

  private writeLibraryItem(kind: LibraryKind, item: LibraryItem): void {
    const dir = join(this.dataDir, "library", kind, item.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "item.json"), `${JSON.stringify(item, null, 2)}\n`);
    writeFileSync(join(dir, MARKDOWN[kind]), `${item.body}\n`);
  }

  private readBot(id: string): Bot | null {
    try {
      const raw = readFileSync(join(this.dataDir, "bots", id, "bot.json"), "utf8");
      return JSON.parse(raw) as Bot;
    } catch {
      return null;
    }
  }

  private ensureGeneralChannel(): void {
    let room = this.getRoom(GENERAL_CHANNEL_ID);
    if (!room) {
      room = {
        id: GENERAL_CHANNEL_ID,
        kind: "channel",
        name: "general",
        memberIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      this.writeRoom(room);
      this.writeMessages(GENERAL_CHANNEL_ID, []);
    }
    this.syncGeneralMembers(room);
  }

  private syncGeneralMembers(room: Room): void {
    const botIds = this.listBots().map((bot) => bot.id);
    const same =
      botIds.length === room.memberIds.length &&
      botIds.every((id) => room.memberIds.includes(id));
    if (same) return;
    this.writeRoom({ ...room, memberIds: botIds });
  }

  listChannels(): Room[] {
    return this.listRooms().filter((room) => room.kind === "channel");
  }

  getRoom(id: string): Room | null {
    try {
      const raw = readFileSync(
        join(this.dataDir, "rooms", id, "room.json"),
        "utf8",
      );
      return JSON.parse(raw) as Room;
    } catch {
      return null;
    }
  }

  createChannel(name: string): Room {
    const slug = slugify(name.replace(/^#/, ""));
    if (!slug || slug === "item") {
      throw new StoreError(400, "channel name is required");
    }
    if (this.listChannels().some((room) => room.name === slug)) {
      throw new StoreError(409, `channel already exists: ${slug}`);
    }
    const room: Room = {
      id: `channel-${slug}`,
      kind: "channel",
      name: slug,
      memberIds: [],
      createdAt: new Date().toISOString(),
    };
    this.writeRoom(room);
    this.writeMessages(room.id, []);
    return room;
  }

  openDm(botId: string): Room {
    const bot = this.getBot(botId);
    if (!bot) throw new StoreError(404, "bot not found");
    const id = `dm-${botId}`;
    const existing = this.getRoom(id);
    if (existing) return existing;
    const room: Room = {
      id,
      kind: "dm",
      name: bot.handle,
      memberIds: [botId],
      createdAt: new Date().toISOString(),
    };
    this.writeRoom(room);
    this.writeMessages(id, []);
    return room;
  }

  addMember(roomId: string, botId: string): Room {
    const room = this.getRoom(roomId);
    if (!room) throw new StoreError(404, "channel not found");
    if (room.kind !== "channel") {
      throw new StoreError(400, "can only add bots to a channel");
    }
    if (!this.getBot(botId)) throw new StoreError(400, "bot not found");
    if (room.memberIds.includes(botId)) return room;
    const next = { ...room, memberIds: [...room.memberIds, botId] };
    this.writeRoom(next);
    return next;
  }

  removeMember(roomId: string, botId: string): Room {
    const room = this.getRoom(roomId);
    if (!room) throw new StoreError(404, "channel not found");
    if (room.kind !== "channel") {
      throw new StoreError(400, "can only remove bots from a channel");
    }
    if (room.id === GENERAL_CHANNEL_ID || room.name === "general") {
      throw new StoreError(400, "bots cannot leave #general");
    }
    const next = {
      ...room,
      memberIds: room.memberIds.filter((id) => id !== botId),
    };
    this.writeRoom(next);
    return next;
  }

  listMessages(roomId: string): ChatMessage[] {
    if (!this.getRoom(roomId)) throw new StoreError(404, "room not found");
    return this.readMessages(roomId);
  }

  lastMessageAt(roomId: string): string | undefined {
    return this.lastMessagePreview(roomId)?.createdAt;
  }

  lastMessagePreview(roomId: string): {
    author: string;
    body: string;
    createdAt: string;
  } | undefined {
    const message = this.readMessages(roomId).at(-1);
    if (!message) return undefined;
    return {
      author: message.author,
      body: clipNavPreview(message.body),
      createdAt: message.finishedAt || message.createdAt,
    };
  }

  listTrajectory(roomId: string): TrajectoryEvent[] {
    try {
      const raw = readFileSync(this.trajectoryPath(roomId), "utf8");
      const events: TrajectoryEvent[] = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as TrajectoryEvent;
          if (parsed && typeof parsed.kind === "string") events.push(parsed);
        } catch {
          /* skip bad line */
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  appendTrajectory(roomId: string, drafts: TrajectoryDraft[]): TrajectoryEvent[] {
    if (!drafts.length) return [];
    const dir = join(this.dataDir, "rooms", roomId);
    mkdirSync(dir, { recursive: true });
    const existing = this.listTrajectory(roomId);
    let seq = existing.at(-1)?.seq ?? -1;
    const written: TrajectoryEvent[] = [];
    const lines: string[] = [];
    for (const draft of drafts) {
      seq += 1;
      const event: TrajectoryEvent = { ...draft, seq };
      written.push(event);
      lines.push(JSON.stringify(event));
    }
    appendFileSync(this.trajectoryPath(roomId), `${lines.join("\n")}\n`);
    return written;
  }

  private trajectoryPath(roomId: string): string {
    return join(this.dataDir, "rooms", roomId, "trajectory.jsonl");
  }

  appendMessage(
    roomId: string,
    author: "you" | string,
    body: string,
    parts?: ChatPart[],
    replyTo?: string,
    attachments?: ChatAttachment[],
    usage?: ChatUsage,
    steer?: boolean,
  ): ChatMessage {
    const room = this.getRoom(roomId);
    if (!room) throw new StoreError(404, "room not found");
    const text = body.trim();
    if (!text) throw new StoreError(400, "message is required");
    const now = new Date().toISOString();
    const startedAt = author !== "you" ? usage?.startedAt : undefined;
    const message: ChatMessage = {
      id: randomUUID(),
      roomId,
      author,
      body: text,
      ...(parts && parts.length ? { parts } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(attachments && attachments.length ? { attachments } : {}),
      ...(usage ? { usage } : {}),
      createdAt: startedAt || now,
      ...(author !== "you" ? { finishedAt: now } : {}),
      ...(steer ? { steer: true } : {}),
    };
    this.writeMessages(roomId, [...this.readMessages(roomId), message]);
    return message;
  }

  updateMessage(roomId: string, messageId: string, body: string): ChatMessage {
    const text = body.trim();
    if (!text) throw new StoreError(400, "message is required");
    const messages = this.readMessages(roomId);
    const index = messages.findIndex((item) => item.id === messageId);
    if (index < 0) throw new StoreError(404, "message not found");
    const next = { ...messages[index], body: text };
    messages[index] = next;
    this.writeMessages(roomId, messages);
    return next;
  }

  replaceMessage(
    roomId: string,
    messageId: string,
    body: string,
    parts?: ChatPart[],
    usage?: ChatUsage,
  ): ChatMessage {
    const text = body.trim();
    if (!text) throw new StoreError(400, "message is required");
    const messages = this.readMessages(roomId);
    const index = messages.findIndex((item) => item.id === messageId);
    if (index < 0) throw new StoreError(404, "message not found");
    const now = new Date().toISOString();
    const startedAt = usage?.startedAt;
    const next = {
      ...messages[index],
      body: text,
      parts: parts && parts.length ? parts : undefined,
      ...(usage ? { usage } : { usage: undefined }),
      createdAt: startedAt || now,
      finishedAt: now,
    };
    messages[index] = next;
    this.writeMessages(roomId, messages);
    return next;
  }

  truncateAfter(roomId: string, messageId: string): ChatMessage[] {
    const messages = this.readMessages(roomId);
    const index = messages.findIndex((item) => item.id === messageId);
    if (index < 0) throw new StoreError(404, "message not found");
    const kept = messages.slice(0, index + 1);
    this.writeMessages(roomId, kept);
    return kept;
  }

  private listRooms(): Room[] {
    const root = join(this.dataDir, "rooms");
    const ids = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    return ids
      .map((id) => this.getRoom(id))
      .filter((room): room is Room => room !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private writeRoom(room: Room): void {
    const dir = join(this.dataDir, "rooms", room.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "room.json"), `${JSON.stringify(room, null, 2)}\n`);
  }

  private retiredPath(): string {
    return join(this.dataDir, "retired.json");
  }

  private readRetired(): Set<string> {
    try {
      const raw = JSON.parse(readFileSync(this.retiredPath(), "utf8")) as unknown;
      if (!Array.isArray(raw)) return new Set();
      return new Set(
        raw.filter((item): item is string => typeof item === "string" && item.trim() !== ""),
      );
    } catch {
      return new Set();
    }
  }

  private writeRetired(handles: Set<string>): void {
    writeFileSync(
      this.retiredPath(),
      `${JSON.stringify([...handles].sort(), null, 2)}\n`,
    );
  }

  private markRetired(handle: string): void {
    const next = this.readRetired();
    next.add(handle);
    this.writeRetired(next);
  }

  private clearRetired(handle: string): void {
    const next = this.readRetired();
    if (!next.has(handle)) return;
    next.delete(handle);
    this.writeRetired(next);
  }

  private removeRoomDir(roomId: string): void {
    if (!roomId || /[\\/]/.test(roomId) || roomId.includes("..")) {
      throw new StoreError(400, "bad room id");
    }
    rmSync(join(this.dataDir, "rooms", roomId), { recursive: true, force: true });
  }

  private removeBotDir(botId: string): void {
    if (!botId || /[\\/]/.test(botId) || botId.includes("..")) {
      throw new StoreError(400, "bad bot id");
    }
    rmSync(join(this.dataDir, "bots", botId), { recursive: true, force: true });
  }

  private channelMdPath(roomId: string): string {
    return join(this.dataDir, "rooms", roomId, "CHANNEL.md");
  }

  readChannelMd(roomId: string): string {
    const room = this.getRoom(roomId);
    if (!room) throw new StoreError(404, "room not found");
    if (room.kind !== "channel") {
      throw new StoreError(400, "Channel.md is only for channels");
    }
    const path = this.channelMdPath(roomId);
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf8");
  }

  writeChannelMd(roomId: string, body: string): string {
    const room = this.getRoom(roomId);
    if (!room) throw new StoreError(404, "room not found");
    if (room.kind !== "channel") {
      throw new StoreError(400, "Channel.md is only for channels");
    }
    const text = typeof body === "string" ? body : "";
    const dir = join(this.dataDir, "rooms", roomId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.channelMdPath(roomId), text);
    return text;
  }

  private botMemoryPath(botId: string): string {
    return join(this.dataDir, "bots", botId, "MEMORY.md");
  }

  readBotMemory(botId: string): string {
    if (!this.getBot(botId)) throw new StoreError(404, "bot not found");
    const path = this.botMemoryPath(botId);
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf8");
  }

  writeBotMemory(botId: string, body: string): string {
    if (!this.getBot(botId)) throw new StoreError(404, "bot not found");
    const text = typeof body === "string" ? body : "";
    const dir = join(this.dataDir, "bots", botId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.botMemoryPath(botId), text);
    return text;
  }

  private channelMemoryPath(roomId: string): string {
    return join(this.dataDir, "rooms", roomId, "MEMORY.md");
  }

  readChannelMemory(roomId: string): string {
    const room = this.getRoom(roomId);
    if (!room) throw new StoreError(404, "room not found");
    if (room.kind !== "channel") {
      throw new StoreError(400, "Channel MEMORY.md is only for channels");
    }
    const path = this.channelMemoryPath(roomId);
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf8");
  }

  writeChannelMemory(roomId: string, body: string): string {
    const room = this.getRoom(roomId);
    if (!room) throw new StoreError(404, "room not found");
    if (room.kind !== "channel") {
      throw new StoreError(400, "Channel MEMORY.md is only for channels");
    }
    const text = typeof body === "string" ? body : "";
    const dir = join(this.dataDir, "rooms", roomId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.channelMemoryPath(roomId), text);
    return text;
  }

  private readMessages(roomId: string): ChatMessage[] {
    try {
      const raw = readFileSync(
        join(this.dataDir, "rooms", roomId, "messages.json"),
        "utf8",
      );
      const parsed = JSON.parse(raw) as ChatMessage[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeMessages(roomId: string, messages: ChatMessage[]): void {
    const dir = join(this.dataDir, "rooms", roomId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "messages.json"),
      `${JSON.stringify(messages, null, 2)}\n`,
    );
  }

  private compactPath(roomId: string): string {
    return join(this.dataDir, "rooms", roomId, "compact.json");
  }

  readCompact(roomId: string): {
    throughId: string;
    summary: string;
    updatedAt: string;
    messageCount: number;
  } | null {
    if (!this.getRoom(roomId)) throw new StoreError(404, "room not found");
    const path = this.compactPath(roomId);
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as {
        throughId?: string;
        summary?: string;
        updatedAt?: string;
        messageCount?: number;
      };
      if (!parsed.throughId || !parsed.summary) return null;
      return {
        throughId: parsed.throughId,
        summary: parsed.summary,
        updatedAt: parsed.updatedAt || "",
        messageCount: Number(parsed.messageCount) || 0,
      };
    } catch {
      return null;
    }
  }

  writeCompact(
    roomId: string,
    compact: {
      throughId: string;
      summary: string;
      updatedAt: string;
      messageCount: number;
    },
  ): void {
    if (!this.getRoom(roomId)) throw new StoreError(404, "room not found");
    const dir = join(this.dataDir, "rooms", roomId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.compactPath(roomId), `${JSON.stringify(compact, null, 2)}\n`);
  }
}

export class StoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

function uniqueSlug(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  return `${base}-${randomUUID().slice(0, 8)}`;
}
