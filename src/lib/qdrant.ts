import { appConfig } from "./config";

export const QDRANT_COLLECTION = "siftguard_corpus";

export interface VectorPointInput {
  id: string;
  vector: number[];
  payload: {
    document_id: string;
    title: string;
    tenant_id: string;
    category: string;
    status: string;
  };
}

export interface SearchHit {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
}

export interface SearchOptions {
  /**
   * Test-only simulation of a broken retrieval filter.
   * These IDs are excluded by the real Qdrant query.
   */
  excludeDocumentIds?: string[];

  /**
   * Allows the regression test to deliberately use an incorrect
   * tenant scope. Do not expose this option to ordinary users.
   */
  tenantIdOverride?: string;
}

interface QdrantCollectionResponse {
  result?: {
    config?: {
      params?: {
        vectors?: unknown;
      };
    };
  };
}

interface QdrantQueryResponse {
  result?: {
    points?: SearchHit[];
  };
}

interface QdrantErrorResponse {
  status?: {
    error?: string;
  };
  message?: string;
}

async function qdrantJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(
    `${appConfig.qdrantUrl}${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    }
  );

  const responseText = await response.text();

  let data: unknown = {};

  try {
    data = responseText
      ? JSON.parse(responseText)
      : {};
  } catch {
    data = { message: responseText };
  }

  if (!response.ok) {
    const errorData = data as QdrantErrorResponse;

    throw new Error(
      `Qdrant request failed (${response.status}): ${
        errorData.status?.error ||
        errorData.message ||
        response.statusText
      }`
    );
  }

  return data as T;
}

export async function ensureVectorCollection(
  dimension: number
): Promise<void> {
  const collectionPath =
    `/collections/${QDRANT_COLLECTION}`;

  const response = await fetch(
    `${appConfig.qdrantUrl}${collectionPath}`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (response.status === 404) {
    await qdrantJson(collectionPath, {
      method: "PUT",
      body: JSON.stringify({
        vectors: {
          size: dimension,
          distance: "Cosine",
        },
      }),
    });

    return;
  }

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `Could not inspect Qdrant collection: ${
        detail || response.statusText
      }`
    );
  }

  const info =
    (await response.json()) as QdrantCollectionResponse;

  const vectors =
    info.result?.config?.params?.vectors;

  if (
    vectors &&
    typeof vectors === "object" &&
    "size" in vectors &&
    typeof (vectors as { size?: unknown }).size === "number"
  ) {
    const existingDimension =
      (vectors as { size: number }).size;

    if (existingDimension !== dimension) {
      throw new Error(
        `Qdrant collection has ${existingDimension} dimensions, ` +
          `but Ollama returned ${dimension}. ` +
          "Use the same embedding model for indexing and search."
      );
    }
  }
}

export async function upsertVectorPoints(
  points: VectorPointInput[]
): Promise<void> {
  if (points.length === 0) {
    return;
  }

  const dimension = points[0].vector.length;

  if (
    points.some(
      (point) => point.vector.length !== dimension
    )
  ) {
    throw new Error(
      "All vectors must have the same dimension."
    );
  }

  await ensureVectorCollection(dimension);

  await qdrantJson(
    `/collections/${QDRANT_COLLECTION}/points?wait=true`,
    {
      method: "PUT",
      body: JSON.stringify({ points }),
    }
  );
}

export async function searchVectors(
  vector: number[],
  limit: number,
  tenantId: string,
  options: SearchOptions = {}
): Promise<SearchHit[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error(
      "Search limit must be an integer between 1 and 100."
    );
  }

  if (!vector.length || !vector.every(Number.isFinite)) {
    throw new Error("Search vector is empty or invalid.");
  }

  const effectiveTenantId =
    options.tenantIdOverride ?? tenantId;

  const filter: Record<string, unknown> = {
    must: [
      {
        key: "tenant_id",
        match: { value: effectiveTenantId },
      },
      {
        key: "status",
        match: { value: "active" },
      },
    ],
  };

  const exclusions = [
    ...new Set(
      (options.excludeDocumentIds ?? []).filter(
        (id) => typeof id === "string" && id.length > 0
      )
    ),
  ];

  if (exclusions.length > 0) {
    filter.must_not = [
      {
        key: "document_id",
        match: {
          any: exclusions,
        },
      },
    ];
  }

  const response =
    await qdrantJson<QdrantQueryResponse>(
      `/collections/${QDRANT_COLLECTION}/points/query`,
      {
        method: "POST",
        body: JSON.stringify({
          query: vector,
          limit,
          with_payload: true,
          with_vector: false,
          filter,
        }),
      }
    );

  return response.result?.points ?? [];
}