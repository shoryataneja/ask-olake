import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Load be/.env if present (local dev). Real env vars (Render) always win.
const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  enableDebug: process.env.ENABLE_DEBUG === "true",
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  fastModel: process.env.FAST_MODEL ?? "",
  answerModel: process.env.ANSWER_MODEL ?? "",
  answerModelBackup: process.env.ANSWER_MODEL_BACKUP ?? "",
};

if (!config.openrouterApiKey) {
  console.warn("[config] OPENROUTER_API_KEY is not set — LLM features will fail when enabled");
}
if (!config.fastModel || !config.answerModel || !config.answerModelBackup) {
  console.warn("[config] one or more model env vars are not set");
}
