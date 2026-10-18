import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { config } from "./config.js";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));
app.get("/healthz", (c) => c.json({ status: "ok" }));

app.post("/ask", (c) => c.json({ error: "not implemented" }, 501));

app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`ask-olake listening on http://localhost:${info.port}`);
});
