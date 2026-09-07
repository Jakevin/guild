import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DAEMON = join(ROOT, "packages/daemon");
const PROTOCOL = join(ROOT, "packages/protocol");
const SCRIPT = join(DAEMON, "scripts/vendor-protocol.mjs");

function readDep(pkgPath: string): string {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies: Record<string, string>;
  };
  return pkg.dependencies["@guild/protocol"];
}

test("git daemon package.json keeps workspace protocol for pnpm", () => {
  assert.equal(readDep(join(DAEMON, "package.json")), "workspace:*");
});

test("prepack vendors protocol as file:; postpack restores workspace:*", () => {
  const home = mkdtempSync(join(tmpdir(), "guild-vendor-"));
  const daemon = join(home, "daemon");
  const protocol = join(home, "protocol");
  try {
    cpSync(PROTOCOL, protocol, { recursive: true });
    mkdirSync(join(daemon, "scripts"), { recursive: true });
    cpSync(SCRIPT, join(daemon, "scripts/vendor-protocol.mjs"));
    writeFileSync(
      join(daemon, "package.json"),
      JSON.stringify(
        {
          name: "@kevin5251984/guild",
          version: "0.0.0-test",
          dependencies: { "@guild/protocol": "workspace:*" },
        },
        null,
        2,
      ) + "\n",
    );

    const pre = spawnSync(
      process.execPath,
      [join(daemon, "scripts/vendor-protocol.mjs"), "prepack"],
      { encoding: "utf8" },
    );
    assert.equal(pre.status, 0, pre.stderr || pre.stdout);
    assert.equal(readDep(join(daemon, "package.json")), "file:./vendor/protocol");
    assert.match(
      readFileSync(join(daemon, "vendor/protocol/src/index.ts"), "utf8"),
      /HealthResponse/,
    );

    const post = spawnSync(
      process.execPath,
      [join(daemon, "scripts/vendor-protocol.mjs"), "postpack"],
      { encoding: "utf8" },
    );
    assert.equal(post.status, 0, post.stderr || post.stdout);
    assert.equal(readDep(join(daemon, "package.json")), "workspace:*");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
