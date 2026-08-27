import { Service, type Context } from "cordis";
import type { AuxRole, ModelRef, ModelsFile } from "@guild/protocol";
import {
  llmComplete,
  mergeModelsFile,
  publicModels,
  readModelsFile,
  resolveLlm,
} from "../llm.ts";

export class LlmService extends Service {
  static inject = ["store"];

  constructor(ctx: Context) {
    super(ctx, "llm");
  }

  readModels(): ModelsFile {
    return readModelsFile(this.ctx.store.dataDir);
  }

  mergeModels(patch: Partial<ModelsFile>): ModelsFile {
    return mergeModelsFile(this.ctx.store.dataDir, patch);
  }

  publicModels(env: NodeJS.ProcessEnv = this.ctx.store.env) {
    return publicModels(this.ctx.store.dataDir, env);
  }

  resolve(
    env: NodeJS.ProcessEnv = this.ctx.store.env,
    role?: AuxRole | "chat",
    prefer?: ModelRef | null,
  ) {
    return resolveLlm(this.ctx.store.dataDir, env, role, prefer);
  }

  complete(
    input: Omit<Parameters<typeof llmComplete>[0], "dataDir"> & {
      dataDir?: string;
    },
  ) {
    return llmComplete({
      ...input,
      dataDir: input.dataDir ?? this.ctx.store.dataDir,
    });
  }
}

export default LlmService;
