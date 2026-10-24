function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function normaliseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

const rawEndpoint = normaliseUrl(requiredEnv("APPWRITE_ENDPOINT"));

export const appConfig = {
  appwriteEndpoint: rawEndpoint.endsWith("/v1")
    ? rawEndpoint
    : `${rawEndpoint}/v1`,

  appwriteProjectId: requiredEnv("APPWRITE_PROJECT_ID"),
  appwriteApiKey: requiredEnv("APPWRITE_API_KEY"),
  databaseId: requiredEnv("APPWRITE_DATABASE_ID"),

  tables: {
    suites: requiredEnv("APPWRITE_SUITES_TABLE_ID"),
    cases: requiredEnv("APPWRITE_CASES_TABLE_ID"),
    runs: requiredEnv("APPWRITE_RUNS_TABLE_ID"),
    results: requiredEnv("APPWRITE_RESULTS_TABLE_ID"),
    documents: requiredEnv("APPWRITE_DOCUMENTS_TABLE_ID"),
    rules: requiredEnv("APPWRITE_RULES_TABLE_ID"),
  },

  qdrantUrl: normaliseUrl(
    process.env.QDRANT_URL || "http://127.0.0.1:6333"
  ),

  ollamaBaseUrl: normaliseUrl(
    process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
  ),

  embeddingModel:
    process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text",
} as const;