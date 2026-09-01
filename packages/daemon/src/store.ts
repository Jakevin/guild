import {
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
import { closeGuildDb, openGuildDb, type GuildDb } from "./db.ts";
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
import {
  parseMentionIds,
  sanitizeMentionIds,
  withoutDeferredIds,
} from "./mention.ts";

const MARKDOWN: Record<LibraryKind, string> = {
  souls: "SOUL.md",
  agents: "AGENTS.md",
  skills: "SKILL.md",
  positions: "POSITION.md",
  subagents: "SUBAGENT.toml",
};

const GENERAL_CHANNEL_ID = "channel-general";
const NAV_PREVIEW_CAP = 120;
/** Project channels (not #general). Reuse seats first; human adds specialists. */
export const CHANNEL_ROSTER_CAP = 6;
/** Parent → child → grandchild. Deeper than this hides in the sidebar. */
export const BRANCH_DEPTH_CAP = 3;
/** Messages copied from the parent, ending at the branched row. */
export const BRANCH_CONTEXT_CAP = 20;

export function isGeneralChannel(room: { id: string; name: string }): boolean {
  return room.id === GENERAL_CHANNEL_ID || room.name === "general";
}

export function clipNavPreview(body: string): string {
  return String(body || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAV_PREVIEW_CAP);
}

/** Transport / login failures that should not stay in the thread once a new turn starts. */
export function isFailedAssistantReply(body: string): boolean {
  const text = String(body || "").trim();
  if (!text) return false;
  if (
    /^(connection error\.?|failed to fetch|load failed|networkerror\b.*)$/i.test(
      text,
    )
  ) {
    return true;
  }
  return /登入已失效|模型請求失敗|模型請求逾時|不是訂閱失效|這個 GitHub Copilot 帳號不支援|unauthorized|not logged in|econnrefused|econnreset|login failed/i.test(
    text.slice(0, 400),
  );
}

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.GUILD_HOME ?? join(homedir(), ".guild");
}

export type LiveStep = {
  name: string;
  detail: string;
  running?: boolean;
};

export type LiveTrace = {
  name: string;
  args?: Record<string, unknown>;
  text?: string;
  isError?: boolean;
  running?: boolean;
};

export type LiveTurn = {
  botId: string;
  thinking: string;
  steps: LiveStep[];
  startedAt?: string;
  /** Full-ish tool history for Trajectory. Stripped from GET /live. */
  traces?: LiveTrace[];
  /** Seat assignment text, kept so Continue can resume after Pause. */
  asked?: string;
  paused?: boolean;
};

export class GuildStore {
  private readonly liveTurns = new Map<string, Map<string, LiveTurn>>();
  private readonly pendingSteers = new Map<string, Map<string, string[]>>();
  private readonly botAborts = new Map<string, Map<string, AbortController>>();
  private readonly turnGroups = new Map<
    AbortSignal,
    { roomId: string; botIds: Set<string>; controller: AbortController }
  >();
  private readonly db: GuildDb;
  private closed = false;

  constructor(readonly dataDir: string) {
    mkdirSync(join(dataDir, "library", "souls"), { recursive: true });
    mkdirSync(join(dataDir, "library", "agents"), { recursive: true });
    mkdirSync(join(dataDir, "library", "skills"), { recursive: true });
    mkdirSync(join(dataDir, "library", "positions"), { recursive: true });
    mkdirSync(join(dataDir, "library", "subagents"), { recursive: true });
    mkdirSync(join(dataDir, "bots"), { recursive: true });
    mkdirSync(join(dataDir, "rooms"), { recursive: true });
    this.db = openGuildDb(dataDir);
    this.db.importLegacyFiles(dataDir);
    this.seedCatalog();
    this.seedDefaultBots();
    this.ensureGeneralChannel();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeGuildDb(this.db);
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
    let room = this.liveTurns.get(roomId);
    if (!room) {
      room = new Map();
      this.liveTurns.set(roomId, room);
    }
    room.set(turn.botId || "", turn);
  }

  clearLiveTurn(roomId: string): void {
    this.liveTurns.delete(roomId);
    this.pendingSteers.delete(roomId);
  }

  dropLiveBotTurn(roomId: string, botId: string): void {
    const live = this.liveTurns.get(roomId);
    if (!live) return;
    live.delete(botId);
    if (live.size === 0) this.liveTurns.delete(roomId);
    const steers = this.pendingSteers.get(roomId);
    steers?.delete(botId);
    if (steers && steers.size === 0) this.pendingSteers.delete(roomId);
  }

  getLiveTurn(roomId: string): LiveTurn | null {
    const room = this.liveTurns.get(roomId);
    if (!room || room.size === 0) return null;
    return [...room.values()][room.size - 1] ?? null;
  }

  getLiveBotTurn(roomId: string, botId: string): LiveTurn | null {
    return this.liveTurns.get(roomId)?.get(botId) ?? null;
  }

  listLiveRoomTurns(roomId: string): LiveTurn[] {
    return [...(this.liveTurns.get(roomId)?.values() ?? [])];
  }

  listLiveTurns(): { roomId: string; turn: LiveTurn }[] {
    const out: { roomId: string; turn: LiveTurn }[] = [];
    for (const [roomId, room] of this.liveTurns) {
      for (const turn of room.values()) out.push({ roomId, turn });
    }
    return out;
  }

  private bindBotAbort(
    roomId: string,
    botId: string,
    controller: AbortController,
  ): void {
    let room = this.botAborts.get(roomId);
    if (!room) {
      room = new Map();
      this.botAborts.set(roomId, room);
    }
    const prev = room.get(botId);
    if (prev && prev !== controller && !prev.signal.aborted) prev.abort();
    room.set(botId, controller);
  }

  beginTurn(roomId: string, botIds: string[] = [""]): AbortSignal {
    const controller = new AbortController();
    const ids = botIds.length ? botIds : [""];
    this.turnGroups.set(controller.signal, {
      roomId,
      botIds: new Set(ids),
      controller,
    });
    return controller.signal;
  }

  /**
   * Per-seat AbortController, child of the turn group. Pause/Stop one bot
   * without taking the rest of the wave down.
   */
  armBotTurn(roomId: string, botId: string, parent: AbortSignal): AbortSignal {
    const controller = new AbortController();
    const onParent = () => {
      if (!controller.signal.aborted) controller.abort();
    };
    if (parent.aborted) onParent();
    else parent.addEventListener("abort", onParent, { once: true });
    this.bindBotAbort(roomId, botId, controller);
    const group = this.turnGroups.get(parent);
    if (group && group.roomId === roomId) group.botIds.add(botId);
    return controller.signal;
  }

  adoptTurn(roomId: string, botId: string, signal: AbortSignal): void {
    const group = this.turnGroups.get(signal);
    if (!group || group.roomId !== roomId) return;
    group.botIds.add(botId);
  }

  private dropBotLive(roomId: string, botId: string): boolean {
    const live = this.liveTurns.get(roomId);
    const steers = this.pendingSteers.get(roomId);
    const room = this.botAborts.get(roomId);
    const hadLive = Boolean(live?.delete(botId));
    steers?.delete(botId);
    room?.delete(botId);
    if (live && live.size === 0) this.liveTurns.delete(roomId);
    if (steers && steers.size === 0) this.pendingSteers.delete(roomId);
    if (room && room.size === 0) this.botAborts.delete(roomId);
    for (const [sig, group] of this.turnGroups) {
      if (group.roomId !== roomId || !group.botIds.has(botId)) continue;
      group.botIds.delete(botId);
      if (group.botIds.size === 0) this.turnGroups.delete(sig);
    }
    return hadLive;
  }

  abortTurn(roomId: string, botId?: string): boolean {
    if (botId) {
      const controller = this.botAborts.get(roomId)?.get(botId);
      const hadLive = this.dropBotLive(roomId, botId);
      if (controller && !controller.signal.aborted) controller.abort();
      this.spillTrajectoryIfIdle(roomId);
      return hadLive || Boolean(controller);
    }
    const room = this.botAborts.get(roomId);
    this.botAborts.delete(roomId);
    this.liveTurns.delete(roomId);
    this.pendingSteers.delete(roomId);
    let aborted = false;
    const seen = new Set<AbortController>();
    for (const [sig, group] of [...this.turnGroups]) {
      if (group.roomId !== roomId) continue;
      this.turnGroups.delete(sig);
      if (!group.controller.signal.aborted) {
        group.controller.abort();
        aborted = true;
      }
      seen.add(group.controller);
    }
    for (const controller of room?.values() ?? []) {
      if (seen.has(controller)) continue;
      seen.add(controller);
      if (!controller.signal.aborted) {
        controller.abort();
        aborted = true;
      }
    }
    this.spillTrajectoryIfIdle(roomId);
    return aborted || Boolean(room);
  }

  pauseTurn(roomId: string, botId?: string): boolean {
    const ids = botId
      ? [botId]
      : [...(this.liveTurns.get(roomId)?.keys() ?? [])];
    let any = false;
    for (const id of ids) {
      if (!id) continue;
      const live = this.getLiveBotTurn(roomId, id);
      if (!live) continue;
      const traces = (live.traces || []).map((tr) =>
        tr.running ? { ...tr, running: false, text: tr.text || "paused" } : tr,
      );
      const steps = (live.steps || []).map((step) =>
        step.running ? { ...step, running: false } : step,
      );
      this.setLiveTurn(roomId, {
        ...live,
        traces,
        steps,
        paused: true,
      });
      const controller = this.botAborts.get(roomId)?.get(id);
      this.botAborts.get(roomId)?.delete(id);
      const room = this.botAborts.get(roomId);
      if (room && room.size === 0) this.botAborts.delete(roomId);
      if (controller && !controller.signal.aborted) controller.abort();
      any = true;
    }
    return any;
  }

  endTurn(roomId: string, signal?: AbortSignal): void {
    const group = signal ? this.turnGroups.get(signal) : undefined;
    if (group) {
      this.turnGroups.delete(signal);
      const room = this.botAborts.get(roomId);
      const live = this.liveTurns.get(roomId);
      const steers = this.pendingSteers.get(roomId);
      for (const botId of group.botIds) {
        if (live?.get(botId)?.paused) {
          room?.delete(botId);
          continue;
        }
        room?.delete(botId);
        live?.delete(botId);
        steers?.delete(botId);
      }
      if (room && room.size === 0) this.botAborts.delete(roomId);
      if (live && live.size === 0) this.liveTurns.delete(roomId);
      if (steers && steers.size === 0) this.pendingSteers.delete(roomId);
      if (!group.controller.signal.aborted) group.controller.abort();
    } else {
      const live = this.liveTurns.get(roomId);
      const kept = new Map<string, LiveTurn>();
      for (const [id, turn] of live ?? []) {
        if (turn.paused) kept.set(id, turn);
      }
      this.botAborts.delete(roomId);
      if (kept.size) this.liveTurns.set(roomId, kept);
      else this.clearLiveTurn(roomId);
    }
    this.spillTrajectoryIfIdle(roomId);
  }

  /** Warehouse overflow once, after every bot in the room has stopped. */
  private spillTrajectoryIfIdle(roomId: string): void {
    if (this.botAborts.get(roomId)?.size) return;
    if (this.liveTurns.get(roomId)?.size) return;
    this.db.spillColdTrajectory(roomId);
  }

  pushSteer(roomId: string, text: string, botId?: string): void {
    const body = text.trim();
    if (!body) return;
    let room = this.pendingSteers.get(roomId);
    if (!room) {
      room = new Map();
      this.pendingSteers.set(roomId, room);
    }
    const ids = botId
      ? [botId]
      : this.listLiveRoomTurns(roomId).map((turn) => turn.botId).filter(Boolean);
    const targets = ids.length ? ids : [""];
    for (const id of targets) {
      const list = room.get(id) ?? [];
      list.push(body);
      room.set(id, list);
    }
  }

  drainSteers(roomId: string, botId?: string): string[] {
    const room = this.pendingSteers.get(roomId);
    if (!room) return [];
    if (botId !== undefined) {
      const list = room.get(botId) ?? (botId ? room.get("") ?? [] : []);
      room.delete(botId);
      if (botId) room.delete("");
      if (room.size === 0) this.pendingSteers.delete(roomId);
      return list;
    }
    const all = [...room.values()].flat();
    this.pendingSteers.delete(roomId);
    return all;
  }

  peekSteers(roomId: string, botId?: string): string[] {
    const room = this.pendingSteers.get(roomId);
    if (!room) return [];
    if (botId !== undefined) return room.get(botId) ?? [];
    return [...room.values()].flat();
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
    for (const child of this.listChannels().filter((item) => item.parentId === id)) {
      this.deleteChannel(child.id);
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
      portrait?: string | null;
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
      portrait: Object.hasOwn(input, "portrait")
        ? normalizePortrait(input.portrait)
        : bot.portrait,
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
    return this.db.getRoom(id);
  }

  createChannel(name: string): Room {
    const trimmed = name.replace(/^#/, "").trim();
    if (!trimmed) {
      throw new StoreError(400, "channel name is required");
    }
    if (trimmed === "general") {
      throw new StoreError(400, "cannot create #general");
    }
    if (this.listChannels().some((room) => room.name === trimmed)) {
      throw new StoreError(409, `channel already exists: ${trimmed}`);
    }
    const slug = slugify(trimmed);
    const existingIds = this.listChannels().map((room) => room.id);
    const baseId =
      slug && slug !== "item" && slug !== "general"
        ? `channel-${slug}`
        : `channel-${randomUUID().slice(0, 8)}`;
    const room: Room = {
      id: uniqueSlug(baseId, existingIds),
      kind: "channel",
      name: trimmed,
      memberIds: [],
      createdAt: new Date().toISOString(),
    };
    this.writeRoom(room);
    this.writeMessages(room.id, []);
    return room;
  }

  createBranch(parentId: string, messageId: string, name?: string): Room {
    const parent = this.getRoom(parentId);
    if (!parent) throw new StoreError(404, "channel not found");
    if (parent.kind !== "channel") {
      throw new StoreError(400, "can only branch a channel");
    }
    const source = this.listMessages(parentId).find((item) => item.id === messageId);
    if (!source) throw new StoreError(404, "message not found");
    if (branchDepth(this, parent) >= BRANCH_DEPTH_CAP) {
      throw new StoreError(400, "too many nested branches");
    }
    const trimmed = String(name || "").replace(/^#/, "").trim() || clipBranchName(source.body);
    if (trimmed === "general") {
      throw new StoreError(400, "cannot create #general");
    }
    const taken = this.listChannels().map((room) => room.name);
    const uniqueName = uniqueChannelName(trimmed, taken);
    const existingIds = this.listChannels().map((room) => room.id);
    const slug = slugify(uniqueName);
    const baseId =
      slug && slug !== "item" && slug !== "general"
        ? `channel-${slug}`
        : `channel-${randomUUID().slice(0, 8)}`;
    const room: Room = {
      id: uniqueSlug(baseId, existingIds),
      kind: "channel",
      name: uniqueName,
      memberIds: [...parent.memberIds],
      createdAt: new Date().toISOString(),
      parentId: parent.id,
      branchFromId: source.id,
    };
    this.writeRoom(room);
    this.writeChannelMd(room.id, this.readChannelMd(parent.id));
    const history = this.listMessages(parent.id);
    const at = history.findIndex((item) => item.id === source.id);
    const from = Math.max(0, at + 1 - BRANCH_CONTEXT_CAP);
    const window = at < 0 ? [source] : history.slice(from, at + 1);
    this.writeMessages(room.id, cloneBranchMessages(window, room.id));
    return room;
  }

  renameChannel(id: string, name: string): Room {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new StoreError(400, "channel name is required");
    const room = this.getRoom(id);
    if (!room) throw new StoreError(404, "channel not found");
    if (room.kind !== "channel") {
      throw new StoreError(400, "not a channel");
    }
    if (room.id === GENERAL_CHANNEL_ID || room.name === "general") {
      throw new StoreError(400, "cannot rename #general");
    }
    if (trimmed === "general") {
      throw new StoreError(400, "cannot rename #general");
    }
    if (
      this.listChannels().some((other) => other.id !== room.id && other.name === trimmed)
    ) {
      throw new StoreError(409, `channel already exists: ${trimmed}`);
    }
    if (room.name === trimmed) return room;
    const next = { ...room, name: trimmed };
    this.writeRoom(next);
    return next;
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
    if (
      !isGeneralChannel(room) &&
      room.memberIds.length >= CHANNEL_ROSTER_CAP
    ) {
      throw new StoreError(
        400,
        `這個據點最多 ${CHANNEL_ROSTER_CAP} 席。先移出一位，或改 @ 現有編制。`,
      );
    }
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
    return this.db.listMessages(roomId);
  }

  lastMessageAt(roomId: string): string | undefined {
    return this.lastMessagePreview(roomId)?.createdAt;
  }

  lastMessagePreview(roomId: string): {
    author: string;
    body: string;
    createdAt: string;
  } | undefined {
    const message = this.db.peekLastMessage(roomId);
    if (!message) return undefined;
    return {
      author: message.author,
      body: clipNavPreview(message.body),
      createdAt: message.finishedAt || message.createdAt,
    };
  }

  listTrajectory(roomId: string): TrajectoryEvent[] {
    return this.db.listTrajectory(roomId);
  }

  appendTrajectory(roomId: string, drafts: TrajectoryDraft[]): TrajectoryEvent[] {
    if (!drafts.length) return [];
    if (!this.getRoom(roomId)) return [];
    return this.db.appendTrajectory(roomId, drafts);
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
    steerBotId?: string,
    mentions?: string[],
  ): ChatMessage {
    const room = this.getRoom(roomId);
    if (!room) throw new StoreError(404, "room not found");
    const text = body.trim();
    if (!text) throw new StoreError(400, "message is required");
    const now = new Date().toISOString();
    const startedAt = author !== "you" ? usage?.startedAt : undefined;
    const bots = this.listBots();
    const mentionIds = withoutDeferredIds(
      (mentions !== undefined
        ? sanitizeMentionIds(mentions, bots)
        : parseMentionIds(text, bots, author === "you" ? "user" : "bot")
      ).filter((id) => id !== author),
      text,
      bots,
    );
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
      ...(steer && steerBotId ? { steerBotId } : {}),
      mentions: mentionIds,
    };
    this.db.appendMessage(message);
    return message;
  }

  updateMessage(
    roomId: string,
    messageId: string,
    body: string,
    mentions?: string[],
  ): ChatMessage {
    const text = body.trim();
    if (!text) throw new StoreError(400, "message is required");
    const bots = this.listBots();
    const mentionIds = withoutDeferredIds(
      mentions !== undefined
        ? sanitizeMentionIds(mentions, bots)
        : parseMentionIds(text, bots, "user"),
      text,
      bots,
    );
    const next = this.db.updateMessageBody(roomId, messageId, text, mentionIds);
    if (!next) throw new StoreError(404, "message not found");
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
    const now = new Date().toISOString();
    const current = this.listMessages(roomId).find((item) => item.id === messageId);
    const bots = this.listBots();
    const mentionIds = parseMentionIds(text, bots, "bot").filter(
      (id) => id !== current?.author,
    );
    const next = this.db.replaceMessage(roomId, messageId, {
      body: text,
      parts: parts && parts.length ? parts : undefined,
      usage,
      createdAt: usage?.startedAt || now,
      finishedAt: now,
      mentions: mentionIds,
    });
    if (!next) throw new StoreError(404, "message not found");
    return next;
  }

  dropLastFailedReply(roomId: string, botId: string): ChatMessage | null {
    if (!botId || !this.getRoom(roomId)) return null;
    const messages = this.listMessages(roomId);
    for (let i = messages.length - 1; i >= 0; i--) {
      const item = messages[i];
      if (item.author !== botId) continue;
      if (!isFailedAssistantReply(item.body)) return null;
      return this.db.deleteMessage(roomId, item.id);
    }
    return null;
  }

  deleteMessage(roomId: string, messageId: string): ChatMessage {
    if (!this.getRoom(roomId)) throw new StoreError(404, "room not found");
    const messages = this.listMessages(roomId);
    const current = messages.find((item) => item.id === messageId);
    if (!current) throw new StoreError(404, "message not found");
    if (current.author !== "you") {
      this.abortTurn(roomId, current.author);
    } else {
      const laterYou = messages.some(
        (item, index) =>
          index > messages.indexOf(current) && item.author === "you",
      );
      if (!laterYou) this.abortTurn(roomId);
    }
    const removed = this.db.deleteMessage(roomId, messageId);
    if (!removed) throw new StoreError(404, "message not found");
    return removed;
  }

  truncateAfter(roomId: string, messageId: string): ChatMessage[] {
    const kept = this.db.truncateAfter(roomId, messageId);
    if (!kept) throw new StoreError(404, "message not found");
    return kept;
  }

  private listRooms(): Room[] {
    return this.db.listRooms();
  }

  private writeRoom(room: Room): void {
    this.db.upsertRoom(room);
    mkdirSync(join(this.dataDir, "rooms", room.id), { recursive: true });
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
    this.db.deleteRoom(roomId);
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

  private writeMessages(roomId: string, messages: ChatMessage[]): void {
    this.db.replaceMessages(roomId, messages);
  }

  readCompact(roomId: string): {
    throughId: string;
    summary: string;
    updatedAt: string;
    messageCount: number;
  } | null {
    if (!this.getRoom(roomId)) throw new StoreError(404, "room not found");
    return this.db.readCompact(roomId);
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
    this.db.writeCompact(roomId, compact);
  }
}

function normalizePortrait(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  if (!/^\/generated\/[A-Za-z0-9._-]+$/.test(value)) {
    throw new StoreError(400, "invalid portrait");
  }
  return value;
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

function cloneBranchMessages(items: ChatMessage[], roomId: string): ChatMessage[] {
  const idMap = new Map<string, string>();
  return items.map((item) => {
    const id = randomUUID();
    idMap.set(item.id, id);
    const next: ChatMessage = {
      id,
      roomId,
      author: item.author,
      body: item.body,
      createdAt: item.createdAt,
    };
    if (item.parts?.length) next.parts = item.parts;
    if (item.attachments?.length) next.attachments = item.attachments;
    if (item.usage) next.usage = item.usage;
    if (item.finishedAt) next.finishedAt = item.finishedAt;
    if (item.mentions) next.mentions = item.mentions;
    if (item.steer) next.steer = true;
    if (item.steerBotId) next.steerBotId = item.steerBotId;
    const replyTo = item.replyTo ? idMap.get(item.replyTo) : undefined;
    if (replyTo) next.replyTo = replyTo;
    return next;
  });
}

function clipBranchName(body: string): string {
  return String(body || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28) || "branch";
}

function uniqueChannelName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let i = 2; i < 50; i++) {
    const next = `${name} ${i}`;
    if (!taken.includes(next)) return next;
  }
  return `${name} ${randomUUID().slice(0, 4)}`;
}

function branchDepth(store: GuildStore, room: Room): number {
  let depth = 0;
  let current: Room | null = room;
  const seen = new Set<string>();
  while (current?.parentId) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    depth += 1;
    current = store.getRoom(current.parentId);
    if (depth > 16) break;
  }
  return depth;
}
