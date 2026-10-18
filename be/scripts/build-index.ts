import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_URL = "https://github.com/datazip-inc/olake-docs.git";
const SITE_URL = "https://olake.io";
const MAX_WORDS = 400;
const REPO_DIR = join(tmpdir(), "olake-docs-cache");
const CHECK_URLS = process.argv.includes("--check-urls");

const t0 = Date.now();
function log(stage: string, msg: string) {
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${stage}: ${msg}`);
}

interface Frontmatter {
  title?: string;
  description?: string;
  slug?: string;
  sidebar_label?: string;
}

interface Chunk {
  id: string;
  url: string;
  title: string;
  headingPath: string;
  text: string;
  product: "go" | "fusion";
  version?: string;
  legacy?: boolean;
  lastUpdated: string | null;
  wordCount: number;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outPath = join(scriptDir, "..", "data", "index.json");

// ---------- clone (cached) ----------

function getDocsRepo(): { dir: string; commit: string } {
  if (!existsSync(join(REPO_DIR, ".git"))) {
    log("clone", `first clone into ${REPO_DIR}...`);
    execFileSync("git", ["clone", "--filter=blob:none", "--sparse", REPO_URL, REPO_DIR], {
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["-C", REPO_DIR, "sparse-checkout", "set", "docs", "src/theme/MDXComponents"],
      { stdio: "ignore" },
    );
  } else {
    log("clone", "cached repo found, pulling...");
    try {
      execFileSync("git", ["-C", REPO_DIR, "pull", "--ff-only"], { stdio: "ignore" });
    } catch {
      log("clone", "git pull failed; continuing with cached copy");
    }
  }
  const commit = execFileSync("git", ["-C", REPO_DIR, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  return { dir: REPO_DIR, commit };
}

// ---------- lastUpdated: one git log pass ----------

function buildLastUpdatedMap(repo: string): Map<string, string> {
  log("lastUpdated", "running single git log pass...");
  const map = new Map<string, string>();
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["-C", repo, "log", "--name-only", "--pretty=format:%cs", "--diff-filter=AMR", "--", "docs"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    log("lastUpdated", "git log failed; lastUpdated will be null");
    return map;
  }
  let currentDate = "";
  for (const line of out.split("\n")) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(line)) {
      currentDate = line;
    } else if (line.trim() && currentDate) {
      // git log walks newest-first: first sighting of a path is its most recent date
      if (!map.has(line.trim())) map.set(line.trim(), currentDate);
    }
  }
  log("lastUpdated", `${map.size} paths dated`);
  return map;
}

// ---------- frontmatter ----------

function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: raw };
  const fm: Frontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (kv) (fm as Record<string, string>)[kv[1]] = kv[2];
  }
  return { fm, body: raw.slice(m[0].length) };
}

// ---------- component map (global MDX registry) ----------

function buildComponentMap(repo: string): Map<string, string> {
  const map = new Map<string, string>();
  const indexJs = join(repo, "src/theme/MDXComponents/Index.js");
  const src = readFileSync(indexJs, "utf8");
  const re = /import\s+(\w+)\s+from\s+'[^']*?docs\/shared\/([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) map.set(m[1], `docs/shared/${m[2]}`);
  return map;
}

// ---------- MDX cleaning ----------

function splitFences(text: string): { fence: boolean; text: string }[] {
  const out: { fence: boolean; text: string }[] = [];
  const lines = text.split("\n");
  let buf: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) {
      if (inFence) {
        buf.push(line);
        out.push({ fence: true, text: buf.join("\n") });
        buf = [];
        inFence = false;
      } else {
        if (buf.length) out.push({ fence: false, text: buf.join("\n") });
        buf = [line];
        inFence = true;
      }
    } else {
      buf.push(line);
    }
  }
  if (buf.length) out.push({ fence: inFence, text: buf.join("\n") });
  return out;
}

// ---------- component inlining (linear scanner, no backtracking regexes) ----------

interface TagEnd {
  end: number;
  selfClosing: boolean;
}

function findTagEnd(text: string, from: number): TagEnd {
  let inS = false;
  let inD = false;
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inS) {
      if (c === "'") inS = false;
      continue;
    }
    if (inD) {
      if (c === '"') inD = false;
      continue;
    }
    if (c === "'") inS = true;
    else if (c === '"') inD = true;
    else if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (c === ">" && depth === 0) {
      return { end: i, selfClosing: text[i - 1] === "/" };
    }
  }
  return { end: -1, selfClosing: false };
}

function findClose(text: string, name: string, from: number): number {
  let depth = 1;
  let i = from;
  const openLen = 1 + name.length;
  const closeLen = 2 + name.length;
  while (i < text.length) {
    const open = text.indexOf("<" + name, i);
    const close = text.indexOf("</" + name, i);
    if (close === -1) return -1;
    if (open !== -1 && open < close) {
      const next = text[open + openLen];
      if (next === undefined || /[>\s/]/.test(next)) {
        const { end, selfClosing } = findTagEnd(text, open + openLen);
        if (end === -1) return -1;
        if (!selfClosing) depth++;
        i = end + 1;
        continue;
      }
      i = open + 1;
      continue;
    }
    if (text[close + closeLen] !== ">") {
      i = close + closeLen;
      continue;
    }
    depth--;
    if (depth === 0) return close;
    i = close + closeLen;
  }
  return -1;
}

function processRange(
  text: string,
  repo: string,
  map: Map<string, string>,
  stack: string[],
  from: number,
  to: number,
): string {
  let out = "";
  let i = from;
  while (i < to) {
    const lt = text.indexOf("<", i);
    if (lt === -1 || lt >= to) {
      out += text.slice(i, to);
      break;
    }
    const nm = /^<([A-Z]\w*)/.exec(text.slice(lt, Math.min(lt + 64, to)));
    if (!nm) {
      out += text.slice(i, lt + 1);
      i = lt + 1;
      continue;
    }
    const name = nm[1];
    const nameEnd = lt + 1 + name.length;
    const { end, selfClosing } = findTagEnd(text, nameEnd);
    if (end === -1 || end >= to) {
      out += text.slice(i, lt + 1);
      i = lt + 1;
      continue;
    }
    const path = map.get(name);
    out += text.slice(i, lt);
    if (selfClosing) {
      if (path && path.endsWith(".mdx") && !stack.includes(path)) {
        out += `\n${cleanMdx(readFileSync(join(repo, path), "utf8"), repo, map, [...stack, path])}\n`;
      }
      i = end + 1;
      continue;
    }
    const close = findClose(text, name, end + 1);
    if (close === -1 || close > to) {
      // unbalanced: keep the "<" literally and move on
      out += "<";
      i = lt + 1;
      continue;
    }
    if (path && path.endsWith(".mdx") && !stack.includes(path)) {
      out += `\n${cleanMdx(readFileSync(join(repo, path), "utf8"), repo, map, [...stack, path])}\n`;
    } else {
      out += processRange(text, repo, map, stack, end + 1, close);
    }
    i = close + 2 + name.length + 1;
  }
  return out;
}

function cleanSegment(
  seg: string,
  repo: string,
  map: Map<string, string>,
  stack: string[],
): string {
  // Inline known shared MDX components, keep children of unknown ones, drop unknown self-closing
  let text = processRange(seg, repo, map, stack, 0, seg.length);

  // Fallback for stray component tags (linear, no backreference)
  text = text.replace(/<\/?[A-Z]\w*(?:\s[^<>]*)?>/g, "");
  text = text.replace(/<[A-Z]\w*(?:\s[^<>]*)?\/>/g, "");

  // Lowercase HTML: keep inner text, drop img/br/self-closing
  text = text.replace(/<(img|br|hr|input|meta|link)\b[^>]*\/?>/gi, "");
  text = text.replace(/<\/?[a-z][^>]*>/gi, "");

  // Admonitions: :::type[Title] -> **Note (type): Title**, bare ::: removed
  text = text
    .split("\n")
    .map((line) => {
      const open = line.match(/^:::(\w+)(?:\[(.*)\])?\s*$/);
      if (open) {
        const type = open[1];
        const title = open[2];
        return title
          ? `**Note (${type}): ${title}**`
          : `**Note (${type}):**`;
      }
      if (/^:::\s*$/.test(line)) return "";
      return line;
    })
    .join("\n");

  // JSX comment anchors {# ...} / {/* ... */}
  text = text.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  // Markdown images
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // Collapse blank lines
  text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}

function cleanMdx(
  raw: string,
  repo: string,
  map: Map<string, string>,
  stack: string[] = [],
): string {
  let { body } = parseFrontmatter(raw);
  // Page-level imports of docs files (e.g. understanding partials) extend the map
  const localMap = new Map(map);
  const importRe = /import\s+(\w+)\s+from\s+'@site\/docs\/([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(body))) localMap.set(m[1], `docs/${m[2]}`);
  body = body.replace(/^import .*?;?\s*$/gm, "");
  body = body.replace(/<Head>[\s\S]*?<\/Head>/g, "");

  const parts = splitFences(body);
  return parts
    .map((p) => (p.fence ? p.text : cleanSegment(p.text, repo, localMap, stack)))
    .join("\n");
}

// ---------- URL mapping ----------

function pageUrl(relPath: string, fm: Frontmatter): string {
  if (fm.slug === "/") return `${SITE_URL}/docs/`;
  let route = relPath.replace(/^docs\//, "").replace(/\.mdx$/, "");
  if (route.endsWith("/index")) route = route.slice(0, -"/index".length);
  return `${SITE_URL}/docs/${route}/`;
}

function metaTags(relPath: string): Pick<Chunk, "product" | "version" | "legacy"> {
  const product = relPath.startsWith("docs/fusion/") ? "fusion" : "go";
  const versionMatch = relPath.match(
    /release\/(?:ingestion|maintenance)\/(v[\d.]+(?:-v[\d.]+)?)\.mdx$/,
  );
  const legacy =
    relPath.startsWith("docs/archive/") ||
    relPath === "docs/connectors/postgres/wal2json_plugin.mdx";
  return { product, version: versionMatch?.[1], legacy: legacy || undefined };
}

// ---------- chunking ----------

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function splitLongParagraph(text: string, cap: number): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  let buf: string[] = [];
  let count = 0;
  for (const line of lines) {
    const w = wordCount(line);
    if (count + w > cap && buf.length) {
      out.push(buf.join("\n"));
      buf = [];
      count = 0;
    }
    buf.push(line);
    count += w;
  }
  if (buf.length) out.push(buf.join("\n"));
  return out;
}

function chunkPage(
  cleaned: string,
  url: string,
  title: string,
  meta: ReturnType<typeof metaTags>,
  lastUpdated: string | null,
  pageId: string,
): Chunk[] {
  // Split into sections at H1-H3 headings (fence-aware)
  interface Section {
    level: number;
    heading: string;
    lines: string[];
  }
  const sections: Section[] = [];
  let current: Section = { level: 0, heading: title, lines: [] };
  let inFence = false;
  for (const line of cleaned.split("\n")) {
    if (/^(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence ? line.match(/^(#{1,3})\s+(.*)$/) : null;
    if (h) {
      if (current.lines.some((l) => l.trim())) sections.push(current);
      current = { level: h[1].length, heading: h[2].replace(/\s*\{#[^}]*\}/, "").trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.trim())) sections.push(current);

  // Heading path stack
  const chunks: Chunk[] = [];
  const pathStack: string[] = [];
  let sectionIdx = 0;
  for (const section of sections) {
    if (section.level > 0) {
      while (pathStack.length >= section.level) pathStack.pop();
      pathStack[section.level - 1] = section.heading;
    } else {
      pathStack.length = 0;
    }
    const content = section.lines.join("\n").trim();
    if (!content) continue;

    const headingPath = [title, ...pathStack.filter(Boolean)].join(" > ");

    // Pack paragraphs up to MAX_WORDS
    const paras = content.split(/\n\s*\n/);
    const pieces: string[] = [];
    let buf: string[] = [];
    let count = 0;
    for (const para of paras) {
      let unit = para;
      const w = wordCount(unit);
      if (w > MAX_WORDS) {
        if (buf.length) {
          pieces.push(buf.join("\n\n"));
          buf = [];
          count = 0;
        }
        pieces.push(...splitLongParagraph(unit, MAX_WORDS));
        continue;
      }
      if (count + w > MAX_WORDS && buf.length) {
        pieces.push(buf.join("\n\n"));
        buf = [];
        count = 0;
      }
      buf.push(unit);
      count += w;
    }
    if (buf.length) pieces.push(buf.join("\n\n"));

    for (const piece of pieces) {
      const text = `${headingPath}\n\n${piece}`;
      chunks.push({
        id: `${pageId}#${sectionIdx++}`,
        url,
        title,
        headingPath,
        text,
        product: meta.product,
        version: meta.version,
        legacy: meta.legacy,
        lastUpdated,
        wordCount: wordCount(text),
      });
    }
  }
  return chunks;
}

// ---------- file walk ----------

function walkMdx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "shared" || entry.name === "drafts" || entry.name.startsWith("_"))
        continue;
      out.push(...walkMdx(full));
    } else if (entry.name.endsWith(".mdx") && !entry.name.startsWith("_")) {
      out.push(full);
    }
  }
  return out;
}

// ---------- HTTP check ----------

async function checkUrls(
  urls: string[],
  concurrency: number,
): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const url = urls[i++];
      try {
        const res = await fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(20000),
        });
        await res.body?.cancel();
        results.set(url, res.status);
      } catch {
        results.set(url, 0);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ---------- main ----------

async function main() {
  const { dir: repo, commit } = getDocsRepo();

  const componentMap = buildComponentMap(repo);
  const lastUpdatedMap = buildLastUpdatedMap(repo);
  const files = walkMdx(join(repo, "docs")).sort();
  log("walk", `${files.length} doc pages`);

  log("parse", "cleaning + chunking pages...");
  const allChunks: Chunk[] = [];
  const urlToPages = new Map<string, string[]>();

  for (const file of files) {
    const rel = relative(repo, file).replace(/\\/g, "/");
    if (rel === "docs/roadmap.mdx") continue; // redirect stub, no content
    const pageStart = Date.now();
    const raw = readFileSync(file, "utf8");
    const { fm } = parseFrontmatter(raw);
    const url = pageUrl(rel, fm);
    const cleaned = cleanMdx(raw, repo, componentMap);
    const meta = metaTags(rel);
    const lastUpdated = lastUpdatedMap.get(rel) ?? null;
    const pageId = rel.replace(/^docs\//, "").replace(/\.mdx$/, "");
    const chunks = chunkPage(cleaned, url, fm.title ?? pageId, meta, lastUpdated, pageId);
    allChunks.push(...chunks);
    urlToPages.set(url, [...(urlToPages.get(url) ?? []), rel]);
    const ms = Date.now() - pageStart;
    if (ms > 200 || allChunks.length % 25 === 0) {
      log("parse", `${urlToPages.size} pages, ${allChunks.length} chunks (last: ${rel} ${ms}ms)`);
    }
  }
  log("parse", `done: ${allChunks.length} chunks from ${urlToPages.size} pages`);

  let failures: [string, number][] = [];
  if (CHECK_URLS) {
    log("urlcheck", `checking ${urlToPages.size} URLs (concurrency 10)...`);
    const statuses = await checkUrls([...urlToPages.keys()], 10);
    failures = [...statuses.entries()].filter(([, s]) => s !== 200);
    log("urlcheck", `done: ${urlToPages.size - failures.length} ok, ${failures.length} failed`);
  } else {
    log("urlcheck", "skipped (pass --check-urls to enable)");
  }

  const failedUrls = new Set(failures.map(([u]) => u));
  const kept = allChunks.filter((c) => !failedUrls.has(c.url));

  mkdirSync(dirname(outPath), { recursive: true });
  const index = {
    builtAt: new Date().toISOString(),
    source: REPO_URL,
    sourceCommit: commit,
    chunkCount: kept.length,
    chunks: kept,
  };
  writeFileSync(outPath, JSON.stringify(index, null, 1));
  log("write", outPath);

  // ---------- report ----------
  const go = kept.filter((c) => c.product === "go").length;
  const fusion = kept.filter((c) => c.product === "fusion").length;
  console.log("\n=== BUILD REPORT ===");
  console.log(`pages: ${urlToPages.size}, chunks: ${kept.length} (go: ${go}, fusion: ${fusion})`);
  if (CHECK_URLS) {
    console.log(`URL check: ${urlToPages.size - failures.length} ok, ${failures.length} failed`);
    if (failures.length) {
      console.log("failures:");
      for (const [url, status] of failures) {
        console.log(`  ${status} ${url} (${urlToPages.get(url)?.join(", ")})`);
      }
    }
  }
  console.log("\n5 largest chunks:");
  for (const c of [...kept].sort((a, b) => b.wordCount - a.wordCount).slice(0, 5)) {
    console.log(`  ${c.wordCount}w ${c.id} ${c.url}`);
  }
  console.log("\n5 random sample chunks:");
  const sample = [...kept].sort(() => Math.random() - 0.5).slice(0, 5);
  for (const c of sample) {
    console.log(`---\n${c.id} | ${c.url} | product=${c.product}${c.version ? ` version=${c.version}` : ""}${c.legacy ? " legacy" : ""} | ${c.wordCount}w`);
    console.log(c.text.slice(0, 300).replace(/\n+/g, " / "));
  }
  log("done", `${((Date.now() - t0) / 1000).toFixed(1)}s total`);
}

if (!process.env.BUILD_INDEX_NO_MAIN) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { cleanMdx, buildComponentMap, parseFrontmatter, chunkPage, pageUrl, metaTags };
