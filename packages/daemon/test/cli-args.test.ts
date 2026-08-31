import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGuildCli, shouldOpenBrowser } from "../src/cli-args.ts";

test("guildd web is the default start", () => {
  assert.deepEqual(parseGuildCli(["node", "guildd"]), {
    help: false,
    version: false,
    open: true,
  });
  assert.deepEqual(parseGuildCli(["node", "guildd", "web"]), {
    help: false,
    version: false,
    open: true,
  });
  assert.deepEqual(parseGuildCli(["node", "guildd", "hall", "--no-open"]), {
    help: false,
    version: false,
    open: false,
  });
});

test("guildd --port and --help", () => {
  assert.equal(parseGuildCli(["node", "guildd", "--port", "8080"]).port, 8080);
  assert.equal(parseGuildCli(["node", "guildd", "--port=9"]).port, 9);
  assert.equal(parseGuildCli(["node", "guildd", "-p", "0"]).port, 0);
  assert.equal(parseGuildCli(["node", "guildd", "--help"]).help, true);
  assert.equal(parseGuildCli(["node", "guildd", "-v"]).version, true);
  assert.match(parseGuildCli(["node", "guildd", "--port", "x"]).error || "", /invalid --port/);
  assert.match(parseGuildCli(["node", "guildd", "serve"]).error || "", /unknown argument/);
});

test("open browser only on a local TTY", () => {
  assert.equal(shouldOpenBrowser(false, {}), false);
  assert.equal(shouldOpenBrowser(true, { GUILD_NO_OPEN: "1" }), false);
  assert.equal(shouldOpenBrowser(true, { SSH_CONNECTION: "1 2 3 4" }), false);
});
