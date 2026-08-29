export type HealthResponse = {
  status: "ok";
  ready: true;
  service: "guildd";
};

export type BotStatus = "bench" | "staffed" | "running" | "retired";

export type ModelRef = { provider: string; model: string };

export type LibraryKind =
  | "souls"
  | "agents"
  | "skills"
  | "positions"
  | "subagents";

export type LibraryItem = {
  id: string;
  slug: string;
  name: string;
  body: string;
  description?: string;
  tags?: string[];
  source?: "catalog" | "user";
  featured?: boolean;
  createdAt: string;
};

export type Bot = {
  id: string;
  handle: string;
  name: string;
  status: BotStatus;
  soulId: string;
  agentTemplateId: string;
  skillIds: string[];
  defaultPositionId: string;
  oneLiner?: string;
  /** Chat model for this bot. Missing → guild default. */
  model?: ModelRef | null;
  createdAt: string;
};

/** Talent bench listing. Empty before any bots exist. */
export type BenchListing = Bot[];

export type RoomKind = "channel" | "dm";

export type Room = {
  id: string;
  kind: RoomKind;
  name: string;
  memberIds: string[];
  createdAt: string;
};

export type ChatPart =
  | { type: "thinking"; text: string }
  | {
      type: "tool";
      name: string;
      detail: string;
      output: string;
      isError?: boolean;
      /** Short UI label (DSH bash `description`). */
      label?: string;
    }
  | { type: "skill"; name: string; output?: string }
  | { type: "text"; text: string };

export type ChatAttachment = {
  token: string;
  title: string;
  body: string;
  /** Small data-URL thumbnail for hover preview. Not sent to the model. */
  preview?: string;
};

/** Per-turn LLM accounting, shown in the message stats panel. */
export type ChatUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  totalTokens?: number;
  costUsd?: number;
  rounds?: number;
  durationMs?: number;
  /** When this agent turn started working. */
  startedAt?: string;
  provider?: string;
  model?: string;
  estimated?: boolean;
};

export type ChatMessage = {
  id: string;
  roomId: string;
  author: "you" | string;
  body: string;
  /** DSH-style transcript rows. Missing on older messages. */
  parts?: ChatPart[];
  /** Parent message id when this is a reply. */
  replyTo?: string;
  /** Composer attachments referenced by tokens like [Image #1]. */
  attachments?: ChatAttachment[];
  usage?: ChatUsage;
  createdAt: string;
  /** When an agent turn finished. User messages omit this. */
  finishedAt?: string;
  /** Injected into a live turn (⌘/Ctrl+Enter), not a new user turn. */
  steer?: boolean;
};

export type LlmApi =
  | "openai-completions"
  | "anthropic-messages"
  | "openai-responses";

export type ModelEntry = {
  id: string;
  name?: string;
};

export type ProviderEntry = {
  name?: string;
  baseUrl: string;
  api: LlmApi;
  apiKey?: string;
  models: ModelEntry[];
};

export type AuxRole =
  | "vision"
  | "web"
  | "compression"
  | "skills"
  | "approval"
  | "title"
  | "generate";

export type ModelsFile = {
  default?: ModelRef | null;
  reasoning?: "minimal" | "low" | "medium" | "high";
  fast?: boolean;
  aux?: Partial<Record<AuxRole, ModelRef | null>>;
  recent?: ModelRef[];
  providers: Record<string, ProviderEntry>;
};

export const DEFAULT_GUILD_HOST = "127.0.0.1";
export const DEFAULT_GUILD_PORT = 7420;
