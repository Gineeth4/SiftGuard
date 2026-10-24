import { NextResponse } from "next/server";
import { Query } from "node-appwrite";

import { appConfig } from "@/lib/config";
import { tablesDB } from "@/lib/appwrite";
import { isAuthorizedRequest } from "@/lib/auth";

const tableSpecs = [
  { name: "test_suites", id: appConfig.tables.suites },
  { name: "test_cases", id: appConfig.tables.cases },
  { name: "evaluation_runs", id: appConfig.tables.runs },
  { name: "evaluation_results", id: appConfig.tables.results },
  { name: "corpus_documents", id: appConfig.tables.documents },
  { name: "test_case_document_rules", id: appConfig.tables.rules },
] as const;

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 300;

interface ErrorDetails {
  message: string;
  code: number | null;
  type: string | null;
}

interface TableCheck {
  name: string;
  id: string;
  ok: boolean;
  attempts: number;
  error?: string;
  errorCode?: number | null;
  errorType?: string | null;
  missing?: boolean;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getErrorDetails(error: unknown): ErrorDetails {
  if (error instanceof Error) {
    const appwriteError = error as Error & {
      code?: unknown;
      type?: unknown;
    };

    return {
      message: error.message,
      code:
        typeof appwriteError.code === "number"
          ? appwriteError.code
          : null,
      type:
        typeof appwriteError.type === "string"
          ? appwriteError.type
          : null,
    };
  }

  if (typeof error === "object" && error !== null) {
    const value = error as {
      message?: unknown;
      code?: unknown;
      type?: unknown;
    };

    return {
      message:
        typeof value.message === "string"
          ? value.message
          : "Unknown Appwrite error.",
      code:
        typeof value.code === "number"
          ? value.code
          : null,
      type:
        typeof value.type === "string"
          ? value.type
          : null,
    };
  }

  return {
    message: String(error),
    code: null,
    type: null,
  };
}

function isMissingTable(error: ErrorDetails): boolean {
  if (error.code === 404) {
    return true;
  }

  return (
    /\btable\b.*\b(not found|does not exist|could not be found)\b/i.test(
      error.message,
    ) ||
    /\b(not found|does not exist)\b.*\btable\b/i.test(
      error.message,
    )
  );
}

function shouldRetry(error: ErrorDetails): boolean {
  // Retrying a missing table or an authorization error will
  // not repair the underlying configuration.
  if ([401, 403, 404].includes(error.code ?? 0)) {
    return false;
  }

  // Other failures may be transient network, throttling,
  // service, or database timeout errors.
  return true;
}

async function checkTable(
  table: (typeof tableSpecs)[number],
): Promise<TableCheck> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await tablesDB.listRows({
        databaseId: appConfig.databaseId,
        tableId: table.id,
        queries: [Query.limit(1)],
      });

      return {
        ...table,
        ok: true,
        attempts: attempt,
      };
    } catch (error) {
      const details = getErrorDetails(error);

      const retry =
        attempt < MAX_ATTEMPTS && shouldRetry(details);

      if (retry) {
        console.warn("[api/health] Appwrite table check failed; retrying.", {
          table: table.name,
          attempt,
          code: details.code,
          type: details.type,
          message: details.message,
        });

        await delay(RETRY_DELAY_MS);
        continue;
      }

      const missing = isMissingTable(details);

      console.error("[api/health] Appwrite table check failed.", {
        table: table.name,
        attempts: attempt,
        missing,
        code: details.code,
        type: details.type,
        message: details.message,
      });

      return {
        ...table,
        ok: false,
        attempts: attempt,
        error: details.message,
        errorCode: details.code,
        errorType: details.type,
        missing,
      };
    }
  }

  // Defensive fallback; the loop normally returns a result.
  return {
    ...table,
    ok: false,
    attempts: MAX_ATTEMPTS,
    error: "Table check exhausted its retry attempts.",
    missing: false,
  };
}

async function checkAppwrite() {
  const tables: TableCheck[] = [];

  // Avoid sending all six checks simultaneously. This reduces
  // request bursts and allows individual transient failures
  // to be retried without repeating successful checks.
  for (const table of tableSpecs) {
    tables.push(await checkTable(table));
  }

  const failedTables = tables.filter((table) => !table.ok);
  const missingTables = failedTables.filter(
    (table) => table.missing,
  );

  return {
    ok: failedTables.length === 0,
    tableCount: tables.filter((table) => table.ok).length,
    tables,
    missingTables: missingTables.map((table) => table.name),
    failedTables: failedTables.map((table) => ({
      name: table.name,
      code: table.errorCode ?? null,
      type: table.errorType ?? null,
      message: table.error ?? "Unknown table check failure.",
      attempts: table.attempts,
      missing: table.missing ?? false,
    })),
  };
}

async function checkQdrant() {
  try {
    const endpoint = appConfig.qdrantUrl.replace(/\/+$/, "");

    const response = await fetch(`${endpoint}/collections`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      return {
        ok: false,
        collections: [] as string[],
      };
    }

    const body = (await response.json()) as {
      result?: {
        collections?: Array<{ name?: string }>;
      };
    };

    return {
      ok: true,
      collections: (body.result?.collections ?? [])
        .map((collection) => collection.name)
        .filter((name): name is string => Boolean(name)),
    };
  } catch (error) {
    console.error("[api/health] Qdrant check failed.", error);

    return {
      ok: false,
      collections: [] as string[],
    };
  }
}

async function checkOllama() {
  const requestedModel =
    process.env.OLLAMA_EMBEDDING_MODEL ??
    appConfig.embeddingModel;

  try {
    const baseUrl = appConfig.ollamaBaseUrl.replace(/\/+$/, "");

    const response = await fetch(`${baseUrl}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      return {
        ok: false,
        modelAvailable: false,
        requestedModel,
        installedModels: [] as string[],
      };
    }

    const body = (await response.json()) as {
      models?: Array<{ name?: string }>;
    };

    const installedModels = (body.models ?? [])
      .map((model) => model.name)
      .filter((name): name is string => Boolean(name));

    const modelAvailable = installedModels.some(
      (name) =>
        name === requestedModel ||
        name === `${requestedModel}:latest` ||
        name.startsWith(`${requestedModel}:`),
    );

    return {
      ok: true,
      modelAvailable,
      requestedModel,
      installedModels,
    };
  } catch (error) {
    console.error("[api/health] Ollama check failed.", error);

    return {
      ok: false,
      modelAvailable: false,
      requestedModel,
      installedModels: [] as string[],
    };
  }
}

export async function GET(request: Request) {
  const [appwrite, qdrant, ollama] = await Promise.all([
    checkAppwrite(),
    checkQdrant(),
    checkOllama(),
  ]);

  const ok =
    appwrite.ok &&
    qdrant.ok &&
    ollama.ok &&
    ollama.modelAvailable;

  const authorized = isAuthorizedRequest(request);

  if (!authorized) {
    return NextResponse.json(
      {
        ok,
        services: {
          appwrite: {
            ok: appwrite.ok,
          },
          qdrant: {
            ok: qdrant.ok,
          },
          ollama: {
            ok: ollama.ok,
            modelAvailable: ollama.modelAvailable,
          },
        },
      },
      {
        status: ok ? 200 : 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return NextResponse.json(
    {
      ok,
      services: {
        appwrite,
        qdrant,
        ollama,
      },
    },
    {
      status: ok ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}