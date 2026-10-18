import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";

export interface Chunk {
  id: string;
  url: string;
  title: string;
  headingPath: string;
  text: string;
  product: string;
  lastUpdated: string;
  wordCount: number;
}

interface IndexFile {
  builtAt: string;
  chunkCount: number;
  chunks: Chunk[];
}

const TOKEN_RE = /[a-z0-9]+(?:[_.\-:/][a-z0-9]+)*/g;

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_RE) ?? [];
}

const here = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(here, "..", "data", "index.json");

let store: MiniSearch<Chunk> | null = null;
let chunksById = new Map<string, Chunk>();

export function loadIndex(): number {
  const raw = readFileSync(INDEX_PATH, "utf8");
  const parsed = JSON.parse(raw) as IndexFile;

  const mini = new MiniSearch<Chunk>({
    fields: ["title", "headingPath", "text"],
    storeFields: ["id", "url", "title", "headingPath", "text", "product"],
    idField: "id",
    tokenize,
    processTerm: (term) => term,
    searchOptions: {
      boost: { title: 3, headingPath: 2, text: 1 },
      bm25: { k: 1.2, b: 0.7, d: 0.5 },
      prefix: true,
      fuzzy: 0.15,
    },
  });

  mini.addAll(parsed.chunks);
  store = mini;
  chunksById = new Map(parsed.chunks.map((c) => [c.id, c]));
  return parsed.chunkCount;
}

export function retrieve(question: string, k = 15): Chunk[] {
  if (!store) loadIndex();
  const results = store!.search(question);
  const seen = new Set<string>();
  const out: Chunk[] = [];
  for (const r of results) {
    const chunk = chunksById.get(r.id);
    if (!chunk || seen.has(chunk.url)) continue;
    seen.add(chunk.url);
    out.push(chunk);
    if (out.length >= k) break;
  }
  return out;
}
