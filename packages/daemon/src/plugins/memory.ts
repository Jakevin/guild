import { Service, type Context } from "cordis";
import { harvestBotMemory, harvestChannelMemory } from "../memory.ts";

export class MemoryService extends Service {
  static inject = ["store", "llm"];

  constructor(ctx: Context) {
    super(ctx, "memory");
    ctx.on("guild/turn-complete", (turn) => {
      const store = ctx.store.guild;
      const env = ctx.store.env;
      const prefer = store.getBot(turn.botId)?.model ?? null;
      void harvestBotMemory({
        store,
        botId: turn.botId,
        userMessage: turn.userText,
        reply: turn.reply,
        env,
        prefer,
      }).catch(() => {});
      const room = store.getRoom(turn.roomId);
      if (room?.kind === "channel") {
        void harvestChannelMemory({
          store,
          roomId: turn.roomId,
          userMessage: turn.userText,
          replies: [
            {
              handle: store.getBot(turn.botId)?.handle,
              author: turn.botId,
              body: turn.reply,
            },
          ],
          env,
          prefer,
        }).catch(() => {});
      }
    });
  }
}

export default MemoryService;
