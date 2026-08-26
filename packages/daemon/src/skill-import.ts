import { StoreError } from "./store.ts";

export type ImportedSkill = {
  name: string;
  slug?: string;
  description: string;
  body: string;
  sourceUrl?: string;
};

const MAX_BYTES = 200_000;

function unquoteYaml(value: string): string {
  const s = value.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function yamlField(front: string, key: string): string {
  const lines = front.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    new RegExp(`^${key}:\\s*`).test(line),
  );
  if (start < 0) return "";
  const after = lines[start].replace(new RegExp(`^${key}:\\s*`), "").trim();
  const block = after === ">" || after === ">-" || after === "|" || after === "|-";
  if (block) {
    const folded = after.startsWith(">");
    const collected: string[] = [];
    let base: number | null = null;
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim() === "") {
        collected.push("");
        continue;
      }
      const indent = (line.match(/^(\s*)/)?.[1] || "").length;
      if (indent === 0) break;
      if (base === null) base = indent;
      if (indent < base) break;
      collected.push(line.slice(base));
    }
    const text = folded
      ? collected
          .join("\n")
          .split(/\n{2,}/)
          .map((para) => para.split(/\n/).map((row) => row.trim()).join(" "))
          .join(" ")
          .replace(/\s+/g, " ")
      : collected.join("\n");
    return text.trim();
  }
  return unquoteYaml(after);
}

export function parseSkillMarkdown(
  text: string,
  fallbackName = "Imported skill",
): ImportedSkill {
  const trimmed = text.replace(/^\uFEFF/, "");
  let name = fallbackName;
  let description = "";
  let body = trimmed;
  const fence = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fence) {
    const front = fence[1];
    body = fence[2].trim();
    name = yamlField(front, "name") || name;
    description = yamlField(front, "description");
  }
  if (!body.trim()) {
    throw new StoreError(400, "SKILL.md has no body");
  }
  const heading = body.match(/^#\s+(.+)$/m);
  if (name === fallbackName && heading) name = heading[1].trim();
  if (!description) {
    description = body.split("\n").find((line) => line.trim() && !line.startsWith("#"))?.trim() ?? "";
  }
  return { name, description, body: body.trim() };
}

export function parseGithubRef(input: string): {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
  file?: string;
} {
  const raw = input.trim();
  if (!raw) throw new StoreError(400, "repo is required");

  const blob = raw.match(
    /github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/i,
  );
  if (blob) {
    return {
      owner: blob[1],
      repo: blob[2].replace(/\.git$/, ""),
      ref: blob[3],
      file: blob[4],
    };
  }
  const tree = raw.match(
    /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.*))?/i,
  );
  if (tree) {
    return {
      owner: tree[1],
      repo: tree[2].replace(/\.git$/, ""),
      ref: tree[3],
      path: tree[4] || undefined,
    };
  }
  const repoUrl = raw.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (repoUrl) {
    return { owner: repoUrl[1], repo: repoUrl[2].replace(/\.git$/, "") };
  }
  const short = raw.match(/^([^/\s]+)\/([^/\s]+)(?:\/(.*))?$/);
  if (short && !raw.includes("://")) {
    return {
      owner: short[1],
      repo: short[2].replace(/\.git$/, ""),
      path: short[3] || undefined,
    };
  }
  throw new StoreError(400, "unrecognized GitHub repo");
}

function assertHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new StoreError(400, "invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new StoreError(400, "only http/https URLs are allowed");
  }
  return parsed;
}

export function githubRawUrl(
  owner: string,
  repo: string,
  ref: string,
  filePath: string,
): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
}

export async function fetchText(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  assertHttpUrl(url);
  const response = await fetchImpl(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "guildd-skill-import" },
  });
  if (!response.ok) {
    throw new StoreError(400, `fetch failed: ${response.status} ${url}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    throw new StoreError(400, "file too large");
  }
  return buf.toString("utf8");
}

export async function importFromUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ImportedSkill[]> {
  const parsed = assertHttpUrl(url);
  if (parsed.hostname === "github.com" && parsed.pathname.includes("/blob/")) {
    const ref = parseGithubRef(url);
    if (ref.file) {
      const raw = githubRawUrl(ref.owner, ref.repo, ref.ref ?? "HEAD", ref.file);
      const text = await fetchText(raw, fetchImpl);
      return [
        {
          ...parseSkillMarkdown(text, ref.file),
          sourceUrl: raw,
        },
      ];
    }
  }
  const text = await fetchText(url, fetchImpl);
  const looksHtml = /^\s*</.test(text) && /<html/i.test(text);
  if (looksHtml) {
    throw new StoreError(
      400,
      "that URL is an HTML page; paste a SKILL.md or GitHub repo instead",
    );
  }
  return [{ ...parseSkillMarkdown(text), sourceUrl: url }];
}

type GitTree = {
  tree?: { path?: string; type?: string }[];
};

export async function importFromGithub(
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ImportedSkill[]> {
  const ref = parseGithubRef(repo);
  if (ref.file?.toLowerCase().endsWith("skill.md")) {
    const raw = githubRawUrl(ref.owner, ref.repo, ref.ref ?? "HEAD", ref.file);
    const text = await fetchText(raw, fetchImpl);
    return [{ ...parseSkillMarkdown(text, ref.file), sourceUrl: raw }];
  }

  const branch = ref.ref ?? "HEAD";
  const treeUrl = `https://api.github.com/repos/${ref.owner}/${ref.repo}/git/trees/${branch}?recursive=1`;
  const treeText = await fetchText(treeUrl, fetchImpl);
  let tree: GitTree;
  try {
    tree = JSON.parse(treeText) as GitTree;
  } catch {
    throw new StoreError(400, "GitHub tree response was not JSON");
  }
  const prefix = ref.path ? `${ref.path.replace(/\/$/, "")}/` : "";
  const files = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && entry.path)
    .map((entry) => entry.path as string)
    .filter((path) => path.toLowerCase().endsWith("/skill.md") || path.toLowerCase() === "skill.md")
    .filter((path) => (prefix ? path.startsWith(prefix) : true));

  if (files.length === 0) {
    throw new StoreError(400, "no SKILL.md found in that repo");
  }

  const imported: ImportedSkill[] = [];
  for (const filePath of files.slice(0, 40)) {
    const raw = githubRawUrl(ref.owner, ref.repo, branch, filePath);
    const text = await fetchText(raw, fetchImpl);
    imported.push({
      ...parseSkillMarkdown(text, filePath),
      sourceUrl: raw,
    });
  }
  return imported;
}
