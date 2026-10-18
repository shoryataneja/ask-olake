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
