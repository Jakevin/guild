import type { AgentDefinition } from "@codebuff/sdk";

export const FREEBUFF_AGENT = "base3-free-deepseek-flash";
export const FREEBUFF_MODEL_ID = "deepseek/deepseek-v4-flash";
export const FREEBUFF_GLM_V53_FLASH_AGENT = "base3-free-glm-5-3-flash";
export const FREEBUFF_GLM_V53_FLASH_MODEL_ID = "z-ai/glm-5.3-flash";

export type FreebuffOfficialRoute = {
  agent: string;
  providerModel: string;
};

const DEEPSEEK: FreebuffOfficialRoute = {
  agent: FREEBUFF_AGENT,
  providerModel: FREEBUFF_MODEL_ID,
};
const GLM: FreebuffOfficialRoute = {
  agent: FREEBUFF_GLM_V53_FLASH_AGENT,
  providerModel: FREEBUFF_GLM_V53_FLASH_MODEL_ID,
};

const ROUTES: Record<string, FreebuffOfficialRoute> = {
  "deepseek-v4-flash-0731": DEEPSEEK,
  "deepseek/deepseek-v4-flash": DEEPSEEK,
  "freebuff/base": DEEPSEEK,
  "glm-5.3-flash": GLM,
  "z-ai/glm-5.3-flash": GLM,
  "freebuff/glm-5.3-flash": GLM,
};

export function resolveFreebuffOfficialRoute(pickerModel: string): FreebuffOfficialRoute | null {
  return ROUTES[pickerModel.trim()] ?? null;
}

/**
 * Official CLI root prompt. Free-mode admission checks the canonical first
 * sentence; do not rewrite it.
 */
function createFreebuffRootAgentDefinition(
  id: string,
  model: string,
  displayName: string,
): AgentDefinition {
  return {
    id,
    publisher: "codebuff",
    model: model as AgentDefinition["model"],
    providerOptions: { data_collection: "deny" },
    displayName,
    spawnerPrompt:
      "Single-loop coding agent that explores, edits, and verifies directly with its own tools",
    inputSchema: {
      prompt: {
        type: "string",
        description: "A coding task to complete",
      },
    },
    outputMode: "last_message",
    includeMessageHistory: true,
    toolNames: [
      "read_files",
      "str_replace",
      "write_file",
      "run_terminal_command",
      "code_search",
      "glob",
      "list_directory",
      "write_todos",
    ],
    systemPrompt: [
      "You are Buffy, the coding agent behind Codebuff. You help users with software engineering tasks: fixing bugs, adding functionality, refactoring, and explaining code.",
      "",
      `Current date: ${new Date().toISOString().slice(0, 10)}.`,
      "",
      "- Match the project's existing conventions. Verify a library is already used in the project before employing it.",
      "- Prefer editing existing files over creating new ones. Make the fewest changes that address the request.",
      "- Verify non-trivial changes by running the project's typecheck and relevant tests.",
      "- Use write_todos to plan and track multi-step tasks.",
      "- Your responses are displayed in a terminal. Keep them short and concise.",
      "- Don't run destructive or hard-to-undo commands (git push, resets, deploys) unless the user asks for them.",
      "",
      "# Freebuff Meta-information",
      "",
      `You are running on the ${model} model.`,
      "You are the AI agent behind Freebuff, a tool where users can chat with you to code with AI for free. See freebuff.com for more information about the product.",
    ].join("\n"),
  };
}

export const FREEBUFF_ROOT_AGENT_DEFINITION = createFreebuffRootAgentDefinition(
  FREEBUFF_AGENT,
  FREEBUFF_MODEL_ID,
  "Buffy on DeepSeek Flash",
);

export const FREEBUFF_GLM_ROOT_AGENT_DEFINITION = createFreebuffRootAgentDefinition(
  FREEBUFF_GLM_V53_FLASH_AGENT,
  FREEBUFF_GLM_V53_FLASH_MODEL_ID,
  "Buffy on GLM 5.3 Flash",
);

export function freebuffRootAgentDefinitionFor(agent: string): AgentDefinition | undefined {
  if (agent === FREEBUFF_AGENT) return FREEBUFF_ROOT_AGENT_DEFINITION;
  if (agent === FREEBUFF_GLM_V53_FLASH_AGENT) return FREEBUFF_GLM_ROOT_AGENT_DEFINITION;
  return undefined;
}

export const FREEBUFF_DENY_MESSAGE =
  "File and shell tools are disabled on this host. Use Guild tools via a guild_tools fence.";

export function denyFreebuffRemoteTools(): NonNullable<
  import("@codebuff/sdk").CodebuffClientOptions["overrideTools"]
> {
  const jsonDeny = async () =>
    [{ type: "json" as const, value: { errorMessage: FREEBUFF_DENY_MESSAGE } }];
  const readDeny = async (input: { filePaths: string[] }) => {
    const out: Record<string, string | null> = {};
    for (const path of input.filePaths) out[path] = null;
    return out;
  };
  return {
    read_files: readDeny,
    str_replace: jsonDeny,
    write_file: jsonDeny,
    apply_patch: jsonDeny,
    run_terminal_command: jsonDeny,
    run_file_change_hooks: jsonDeny,
    code_search: jsonDeny,
    glob: jsonDeny,
    list_directory: jsonDeny,
  } as NonNullable<import("@codebuff/sdk").CodebuffClientOptions["overrideTools"]>;
}
