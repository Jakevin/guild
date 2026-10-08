/**
 * The guild master is the one seat that runs the guild.
 * It is not a member of a channel roster.
 */
import { postUserMessage } from "./handlers.ts";
import { GuildStore, StoreError } from "./store.ts";

export type MainToolResult = { text: string; isError: boolean };

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Models that only saw `{path}` stuffed the real object into that string. */
function seatArgs(args: Record<string, unknown>): {
  name: string;
  handle: string;
  oneLiner?: string;
} {
  let source = args;
  const raw = asString(args.path);
  if (!asString(args.name) && raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        source = { ...args, ...(parsed as Record<string, unknown>) };
      }
    } catch {
      source = args;
    }
  }
  const oneLiner = asString(source.one_liner) || asString(source.description);
  return {
    name: asString(source.name),
    handle: asString(source.handle),
    oneLiner: oneLiner || undefined,
  };
}

function handleList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(" ") : asString(value);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const handle = part.trim().replace(/^@/, "");
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
  }
  return out;
}

function resolveChannel(store: GuildStore, nameOrId: string) {
  const key = nameOrId.replace(/^#/, "").trim();
  if (!key) throw new StoreError(400, "channel name is required");
  const byId = store.getRoom(key);
  if (byId?.kind === "channel") return byId;
  const named = store.listChannels().find((room) => room.name === key);
  if (!named) throw new StoreError(404, `channel not found: ${key}`);
  return named;
}

export function createSeat(
  store: GuildStore,
  input: { name: string; handle: string; oneLiner?: string },
) {
  const skill = store.listLibrary("skills")[0];
  if (!skill) throw new StoreError(400, "no skill in the library");
  const handle = input.handle.trim().replace(/^@/, "");
  const name = input.name.trim();
  return store.createBot({
    name,
    handle,
    oneLiner: input.oneLiner?.trim() || undefined,
    skillIds: [skill.id],
    soul: { name, body: `# ${name}\n\n你是 @${handle}。做這席的工作，不代管整個 Guild。` },
    agent: { name, body: `# ${name}\n\n先讀任務，再動手，做完留下證據。` },
    position: {
      name,
      body: `# ${name}\n\n## Tools\nsandbox: workspace_write\n`,
    },
  });
}

/** Put seats on a channel and build the dispatch message. Does not start the turn. */
export function stageAssign(
  store: GuildStore,
  input: { channel: string; handles: string[]; task: string },
): { roomId: string; body: string } {
  const task = input.task.trim();
  if (!task) throw new StoreError(400, "assign needs a task");
  if (!input.handles.length) throw new StoreError(400, "assign needs a handle");
  const room = resolveChannel(store, input.channel);
  const main = store.mainBotId();
  for (const handle of input.handles) {
    const bot = store.listBots().find((item) => item.handle === handle);
    if (!bot) throw new StoreError(404, `bot not found: ${handle}`);
    if (bot.id === main) throw new StoreError(400, "公會會長不進據點編制。");
    store.addMember(room.id, bot.id);
  }
  const lines = input.handles.map((handle) => `@${handle}`);
  return { roomId: room.id, body: `${lines.join("\n")}\n\n${task}` };
}

export async function runMainTool(
  store: GuildStore,
  name: string,
  args: Record<string, unknown>,
): Promise<MainToolResult> {
  try {
    if (name === "create_bot") {
      const bot = createSeat(store, seatArgs(args));
      return {
        text: `created @${bot.handle} (${bot.name}). They are on #general. They are not the guild master.`,
        isError: false,
      };
    }
    if (name === "create_channel") {
      const room = store.createChannel(asString(args.name));
      return {
        text: `created #${room.name} (${room.id}). The roster is empty until you assign seats.`,
        isError: false,
      };
    }
    if (name === "assign") {
      const staged = stageAssign(store, {
        channel: asString(args.channel),
        handles: handleList(args.handles),
        task: asString(args.task),
      });
      const posted = await postUserMessage(store, staged.roomId, staged.body);
      const who = posted.replies
        .map((reply) => store.getBot(reply.author)?.handle || reply.author)
        .filter(Boolean);
      const started = who.length ? ` Started: @${who.join(", @")}.` : "";
      return {
        text: `assigned on ${staged.roomId}.${started}`,
        isError: false,
      };
    }
    return { text: `unknown main tool: ${name}`, isError: true };
  } catch (error) {
    return {
      text: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}
