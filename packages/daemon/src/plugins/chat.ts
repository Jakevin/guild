import { Service, type Context } from "cordis";
import {
  chatReply,
  generateMarkdown,
  type ChatReply,
  type GenerateKind,
  type GeneratedMarkdown,
} from "../generate.ts";

export class ChatService extends Service {
  static inject = ["store", "llm", "harness"];

  constructor(ctx: Context) {
    super(ctx, "chat");
  }

  reply(input: Parameters<typeof chatReply>[0]): Promise<ChatReply> {
    return this.ctx.harness.turn(input);
  }

  generate(kind: GenerateKind, prompt: string): Promise<GeneratedMarkdown> {
    return generateMarkdown(
      kind,
      prompt,
      this.ctx.store.env,
      this.ctx.store.dataDir,
    );
  }
}

export default ChatService;
