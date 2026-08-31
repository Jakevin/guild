import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const daemon = fileURLToPath(new URL("..", import.meta.url));
const protoSrc = join(daemon, "../protocol");
const vendor = join(daemon, "vendor/protocol");
const pkgPath = join(daemon, "package.json");
const backupPath = join(daemon, "package.json.prepack-backup");

const mode = process.argv[2] || "prepack";

if (mode === "postpack") {
  if (backupPath) {
    try {
      writeFileSync(pkgPath, readFileSync(backupPath, "utf8"));
      rmSync(backupPath, { force: true });
    } catch {
      /* pack may have been interrupted before backup */
    }
  }
  rmSync(join(daemon, "vendor"), { recursive: true, force: true });
  process.exit(0);
}

rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });
cpSync(join(protoSrc, "package.json"), join(vendor, "package.json"));
cpSync(join(protoSrc, "src"), join(vendor, "src"), { recursive: true });

if (!backupPath || mode === "prepack") {
  const raw = readFileSync(pkgPath, "utf8");
  writeFileSync(backupPath, raw);
  const pkg = JSON.parse(raw);
  pkg.dependencies["@guild/protocol"] = "file:./vendor/protocol";
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
