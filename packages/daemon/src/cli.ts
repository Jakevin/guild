import { startGuildDaemon } from "./start.ts";

const started = startGuildDaemon();
started.catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function shutdown() {
  try {
    const { ctx } = await started;
    await ctx.fiber.dispose();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
