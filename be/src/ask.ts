import { config } from "./config.js";
import { retrieve, type Chunk } from "./retrieval.js";

interface ModelReply {
  answerable: boolean;
  answer: string;
  used_chunk_ids: string[];
}

export interface AskResult {
  answer: string;
  sources: string[];
}

const SYSTEM_PROMPT = `You are Ask OLake, a helpful assistant that answers questions about OLake (open-source CDC data ingestion tool) using ONLY the documentation context provided.

Rules:
- Use ONLY facts found in the CONTEXT chunks. Do not use prior knowledge about OLake. Do not invent features, flags, versions or steps.
- The context may be off-topic or insufficient. If it does not let you answer, set "answerable" to false and write a short honest reply (e.g. that this is outside OLake documentation scope or not covered).
- Cite facts by listing the chunk ids you used in "used_chunk_ids". Only include ids you genuinely relied on. Use [] when not answerable.
- Never write URLs. Never guess chunk ids.
- "answer" is markdown, concise and complete: steps, commands, config snippets when the docs give them.

Respond with ONLY a JSON object, no code fences:
{"answerable": boolean, "answer": string, "used_chunk_ids": string[]}`;

function buildUserPrompt(question: string, chunks: Chunk[]): string {
  const parts = chunks.map((c) => {
    const body = c.text.length > 1600 ? c.text.slice(0, 1600) + "\n...(truncated)" : c.text;
    return `--- chunk id: ${c.id} | page: ${c.title} | section: ${c.headingPath}\n${body}`;
  });
  return `CONTEXT chunks:\n\n${parts.join("\n\n")}\n\nQUESTION: ${question}`;
}

function extractJson(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(s.slice(start, end + 1));
}

function parseReply(raw: string): ModelReply {
  const obj = extractJson(raw) as Record<string, unknown>;
  const answerable = Boolean(obj.answerable);
  const answer = typeof obj.answer === "string" ? obj.answer.trim() : "";
  const ids = Array.isArray(obj.used_chunk_ids)
    ? obj.used_chunk_ids.filter((x): x is string => typeof x === "string")
    : [];
  if (!answer) throw new Error("empty answer in reply");
  return { answerable, answer, used_chunk_ids: ids };
}

async function callModel(model: string, question: string, chunks: Chunk[]): Promise<ModelReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openrouterApiKey}`,
        "content-type": "application/json",
        "x-title": "ask-olake",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 2048,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(question, chunks) },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("no content in completion");
    try {
      return parseReply(content);
    } catch (err) {
      console.warn(`[ask] unparseable reply from ${model}: ${JSON.stringify(content).slice(0, 600)}`);
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function callWithFallback(question: string, chunks: Chunk[]): Promise<ModelReply> {
  const models = [config.answerModel, config.answerModelBackup].filter(Boolean);
  let lastError: Error | null = null;
  for (const model of models) {
    try {
      return await callModel(model, question, chunks);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[ask] model ${model} failed: ${lastError.message}`);
    }
  }
  throw lastError ?? new Error("no answer model configured");
}

function buildSources(reply: ModelReply, retrieved: Chunk[]): string[] {
  const retrievedIds = new Set(retrieved.map((c) => c.id));
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const id of reply.answerable ? reply.used_chunk_ids : []) {
    const chunk = retrieved.find((c) => c.id === id);
    if (!chunk || !retrievedIds.has(id) || seen.has(chunk.url)) continue;
    seen.add(chunk.url);
    sources.push(chunk.url);
  }
  return sources;
}

export async function answerQuestion(question: string): Promise<AskResult> {
  const retrieved = retrieve(question, 15);
  if (retrieved.length === 0) {
    return {
      answer:
        "I couldn't find anything about that in the OLake documentation. Try rephrasing, or check https://olake.io/docs/ directly.",
      sources: [],
    };
  }

  let reply: ModelReply;
  try {
    reply = await callWithFallback(question, retrieved);
  } catch (err) {
    console.error(`[ask] all models failed: ${err instanceof Error ? err.message : err}`);
    const fallbackSources = [...new Set(retrieved.slice(0, 3).map((c) => c.url))];
    return {
      answer:
        "I'm having trouble reaching the answer service right now. These pages may be relevant to your question — please check them directly.",
      sources: fallbackSources,
    };
  }

  if (!reply.answerable) {
    return { answer: reply.answer, sources: [] };
  }

  const sources = buildSources(reply, retrieved);
  if (sources.length === 0) {
    return {
      answer:
        `${reply.answer}\n\n_(I couldn't verify a source page for this answer, so treat it with caution.)_`,
      sources: [],
    };
  }
  return { answer: reply.answer, sources };
}
