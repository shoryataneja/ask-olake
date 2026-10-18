# Ask OLake

A production-grade RAG (retrieval-augmented generation) chat assistant for
[OLake documentation](https://olake.io/docs/). Ask a question in plain English,
get a grounded answer built only from the docs, with clickable source links.

**Live endpoints**

- `POST https://ask-olake-lr0d.onrender.com/ask` — `{"question": "..."}` → `{"answer": "...", "sources": ["<url>", ...]}`
- `GET /health`, `GET /healthz` — liveness
- `GET /widget.js` — embeddable chat widget (see [Embedding](#embedding-a-chat-ui))

## Architecture

```
olake-docs (MDX, 124 pages)
        │  be/scripts/build-index.ts   (CI, daily)
        ▼
be/data/index.json                     (1267 chunks, committed to the repo)
        │
        ▼
┌─ POST /ask ────────────────────────────────────────────────┐
│  1. RETRIEVE   MiniSearch BM25 over title/headingPath/text │
│                top-15 chunks, deduped by page URL          │
│  2. ANSWER     one LLM call (OpenRouter): question +       │
│                context chunks → strict JSON                │
│                {answerable, answer, used_chunk_ids}        │
│  3. BUILD      server validates chunk ids against the      │
│     SOURCES    retrieved set, dedupes → absolute URLs      │
└────────────────────────────────────────────────────────────┘
        │
        ▼
{"answer": "...", "sources": ["https://olake.io/docs/.../"]}
```

Backend: **TypeScript + Hono** (Node 20+). Frontend: **React + Vite** chat UI,
plus a dependency-free embeddable widget. Deployed on **Render**.

## Design choices

**Why BM25 instead of embeddings?** The deployment environment restricts the
LLM API key to chat models — no embedding models. So retrieval is
lexical: MiniSearch with BM25 (`k=1.2, b=0.7, d=0.5`), which suits technical
docs anyway (exact tokens like `sync_mode`, `--config`, `wal_level`, error
strings). The tokenizer preserves snake_case / kebab-case / dotted identifiers
instead of splitting them. The answer model sees the raw top-15 chunks; a
separate rerank pass was deliberately cut for latency (single LLM call per
request) and can be slotted in behind `retrieval.ts` later.

**Why the model returns ids, not URLs.** Citation honesty. The prompt forbids
URLs in the answer; the model returns `used_chunk_ids`, and *the server*
validates every id against the retrieved set before turning it into an
`olake.io` URL. A hallucinated id is silently dropped — the model can never
cite a page that wasn't actually in its context. If a "real" answer ends up
with zero verifiable sources, it's flagged as unverified in the response.

**Honest decline beats fabrication.** Out-of-scope questions
(`answerable: false`) return a short refusal and `sources: []`. If the primary
answer model fails, a backup model from env runs; if both fail, the user gets
an explicit "trouble reaching the answer service" message — BM25 results are
never presented as citations for a real answer.

**Index lives in the repo.** Render wipes its disk on every deploy, so
`data/index.json` (1.7 MB) is committed. `npm run build-index` rebuilds it
from a cached sparse clone of `olake-docs`; a scheduled workflow re-runs it
daily so new docs pages flow in without a manual step.

**Model IDs come from env, never code** — `FAST_MODEL`, `ANSWER_MODEL`,
`ANSWER_MODEL_BACKUP` (OpenRouter ids) are read in `src/config.ts`.

## Indexing

```bash
cd be
npm run build-index                 # clone olake-docs → chunk → data/index.json
npm run build-index -- --check-urls # also validates all page URLs (slow)
```

The builder parses MDX (frontmatter, `<Tabs>`/`<TabItem>`, admonitions,
shared-partial inlining), maps slugs to `https://olake.io/docs/.../` URLs
(trailing slash), attaches last-updated dates from git history, and chunks at
heading boundaries (~400 words max), tagging each chunk with
`product` (go | fusion).

## Local development

```bash
cd be
cp .env.example .env      # fill OPENROUTER_API_KEY + model ids
npm install
npm run build-index
npm start                 # http://localhost:3000

cd ../fe
npm install
npm run dev               # http://localhost:5173 (API_BASE in src/App.jsx)
```

`npm run typecheck` must pass (tsc, strict).

## Embedding a chat UI

One script tag on any docs page:

```html
<script src="https://ask-olake-lr0d.onrender.com/widget.js" defer></script>
```

Optional: `data-api="<backend-url>"`, `data-accent="<css color>"`.
The widget injects a floating button + chat panel, talks to `POST /ask`
directly (CORS is open), and renders answers with source links. Preview:
`be/public/demo.html`.

## API

`POST /ask`

```json
{ "question": "How do I set up Postgres CDC?" }
```

```json
{
  "answer": "To configure Postgres CDC ...",
  "sources": ["https://olake.io/docs/connectors/postgres/setup/generic/"]
}
```

Errors: `400` invalid body · `500` unexpected · `503` index not loaded.

## Repository layout

```
be/                 backend (Render Web Service, root dir = be)
  src/index.ts        Hono app, CORS, /ask, static public/
  src/ask.ts          OpenRouter client, prompts, source builder, fallbacks
  src/retrieval.ts    MiniSearch BM25 index + technical tokenizer
  src/config.ts       env loading (.env locally, platform env in prod)
  scripts/build-index.ts  docs → chunked index
  public/widget.js    embeddable chat widget
  data/index.json     committed chunk index
fe/                 chat UI (React + Vite, deploy as Render Static Site)
```
