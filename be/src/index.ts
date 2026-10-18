import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { answerQuestion } from "./ask.js";
import { config } from "./config.js";
import { loadIndex } from "./retrieval.js";

const app = new Hono();

app.use("/*", cors({ origin: "*" }));

app.get("/health", (c) => c.json({ status: "ok" }));
app.get("/healthz", (c) => c.json({ status: "ok" }));

app.get("/version", (c) =>
  c.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? "",
    deployment:
      process.env.VERCEL_DEPLOYMENT_ID ?? process.env.RENDER_INSTANCE_ID ?? "",
  })
);

app.get("/models", async (c) => {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models/user", {
      headers: { authorization: `Bearer ${config.openrouterApiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return c.json({ error: `OpenRouter responded ${res.status}` }, 502);
    }
    const data = (await res.json()) as { data?: { id?: string }[] };
    const models = (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string");
    return c.json({ models });
  } catch (err) {
    console.error("[models] OpenRouter fetch failed:", err);
    return c.json({ error: "failed to reach OpenRouter" }, 502);
  }
});

app.post("/ask", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const question = (body as { question?: unknown })?.question;
  if (typeof question !== "string" || !question.trim() || question.length > 2000) {
    return c.json({ error: "field `question` must be a non-empty string (max 2000 chars)" }, 400);
  }
  if (!indexReady) {
    return c.json({ error: "index not loaded" }, 503);
  }
  try {
    const result = await answerQuestion(question.trim());
    return c.json(result);
  } catch (err) {
    console.error("[ask] unexpected error:", err);
    return c.json({ error: "internal error" }, 500);
  }
});

app.use("/*", serveStatic({ root: "./public" }));

let indexReady = false;
try {
  const n = loadIndex();
  indexReady = true;
  console.log(`[index] loaded ${n} chunks`);
} catch (err) {
  console.error("[index] failed to load data/index.json:", err);
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`ask-olake listening on http://localhost:${info.port}`);
});
