import { startGuildDaemon } from "./start.ts";

startGuildDaemon().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
