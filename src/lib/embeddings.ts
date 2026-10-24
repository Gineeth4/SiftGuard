import { appConfig } from "./config";

interface OllamaEmbeddingResponse {
  model?: string;
  embeddings?: number[][];
  error?: string;
}

export async function embedTexts(
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  if (texts.some((text) => !text.trim())) {
    throw new Error("Embedding input cannot contain empty text.");
  }

  const response = await fetch(
    `${appConfig.ollamaBaseUrl}/api/embed`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: appConfig.embeddingModel,
        input: texts,
        truncate: true,
        keep_alive: "10m",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    }
  );

  const data =
    (await response.json()) as OllamaEmbeddingResponse;

  if (!response.ok) {
    throw new Error(
      `Ollama embedding failed (${response.status}): ${
        data.error || response.statusText
      }`
    );
  }

  if (
    !data.embeddings ||
    data.embeddings.length !== texts.length
  ) {
    throw new Error(
      "Ollama returned an unexpected number of embeddings."
    );
  }

  const dimension = data.embeddings[0]?.length;

  if (!dimension || dimension < 1) {
    throw new Error("Ollama returned an empty embedding.");
  }

  for (const vector of data.embeddings) {
    if (
      vector.length !== dimension ||
      !vector.every(Number.isFinite)
    ) {
      throw new Error(
        "Embedding dimensions or numeric values are invalid."
      );
    }
  }

  return data.embeddings;
}