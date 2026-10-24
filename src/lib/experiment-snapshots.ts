import { createHash } from "node:crypto";

export interface QdrantMetadata {
  available: boolean;
  vectorDimensions: number | null;
  distanceMetric: string | null;
  vectorName: string | null;
}

export interface SnapshotCase {
  id: string;
  query: string;
  category: string;
  tenantId: string;
  topK: number;
  requiredRules: Array<{
    documentId: string;
    maxRank?: number;
  }>;
  forbiddenRules: Array<{
    documentId: string;
  }>;
}

export interface CorpusDocumentMetadata {
  id: string;
  title: string;
  category: string;
  tenantId: string;
  status: string;
  updatedAt: string | null;
}

export interface ExperimentSnapshotInput {
  runId: string;
  suite: {
    id: string;
    name: string;
    status: string;
    minimumRecallAtK: number;
    topK: number;
  };
  cases: SnapshotCase[];
  corpusDocuments: CorpusDocumentMetadata[];
  embeddingModel: string;
  qdrantCollection: string;
  qdrantMetadata: QdrantMetadata;
  appBuild: string | null;
}

export interface ExperimentSnapshot {
  schemaVersion: 1;
  runId: string;
  capturedAt: string;
  suite: ExperimentSnapshotInput["suite"];
  caseCount: number;
  configuration: {
    embeddingProvider: "ollama";
    embeddingModel: string;
    qdrantCollection: string;
    qdrantMetadata: QdrantMetadata;
    filterDefinition: {
      tenantField: "tenant_id";
      statusField: "status";
      requiredStatus: "active";
    };
    topKByCase: Array<{
      caseId: string;
      topK: number;
      tenantId: string;
    }>;
    appBuild: string | null;
  };
  corpus: {
    documentCount: number;
    metadataFingerprint: string;
    fingerprintScope: "document-metadata";
  };
  fingerprints: {
    configurationFingerprint: string;
    contractFingerprint: string;
    corpusFingerprint: string;
  };
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  const object = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};

  for (const key of Object.keys(object).sort()) {
    if (object[key] !== undefined) {
      sorted[key] = canonicalize(object[key]);
    }
  }

  return sorted;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

export function createExperimentSnapshot(
  input: ExperimentSnapshotInput,
): ExperimentSnapshot {
  const cases = [...input.cases].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const documents = [...input.corpusDocuments]
    .map((document) => ({
      id: document.id,
      title: document.title,
      category: document.category,
      tenantId: document.tenantId,
      status: document.status,
      updatedAt: document.updatedAt,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const contractFingerprint = sha256Fingerprint({
    suite: input.suite,
    cases,
  });

  const corpusFingerprint = sha256Fingerprint(documents);

  const configuration: ExperimentSnapshot["configuration"] = {
    embeddingProvider: "ollama",
    embeddingModel: input.embeddingModel,
    qdrantCollection: input.qdrantCollection,
    qdrantMetadata: input.qdrantMetadata,
    filterDefinition: {
      tenantField: "tenant_id",
      statusField: "status",
      requiredStatus: "active",
    },
    topKByCase: cases.map((testCase) => ({
      caseId: testCase.id,
      topK: testCase.topK,
      tenantId: testCase.tenantId,
    })),
    appBuild: input.appBuild,
  };

  const configurationFingerprint = sha256Fingerprint(configuration);

  return {
    schemaVersion: 1,
    runId: input.runId,
    capturedAt: new Date().toISOString(),
    suite: input.suite,
    caseCount: cases.length,
    configuration,
    corpus: {
      documentCount: documents.length,
      metadataFingerprint: corpusFingerprint,
      fingerprintScope: "document-metadata",
    },
    fingerprints: {
      configurationFingerprint,
      contractFingerprint,
      corpusFingerprint,
    },
  };
}

export async function readQdrantCollectionMetadata(
  endpoint: string,
  collection: string,
): Promise<QdrantMetadata> {
  const unavailable: QdrantMetadata = {
    available: false,
    vectorDimensions: null,
    distanceMetric: null,
    vectorName: null,
  };

  try {
    const baseUrl = endpoint.replace(/\/+$/, "");

    const response = await fetch(
      `${baseUrl}/collections/${encodeURIComponent(collection)}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      },
    );

    if (!response.ok) {
      return unavailable;
    }

    const body = (await response.json()) as {
      result?: {
        config?: {
          params?: {
            vectors?: unknown;
          };
        };
      };
    };

    const vectors = body.result?.config?.params?.vectors;

    if (!vectors || typeof vectors !== "object") {
      return unavailable;
    }

    const direct = vectors as {
      size?: unknown;
      distance?: unknown;
    };

    if (typeof direct.size === "number") {
      return {
        available: true,
        vectorDimensions: direct.size,
        distanceMetric:
          typeof direct.distance === "string"
            ? direct.distance
            : null,
        vectorName: "default",
      };
    }

    const namedVectors = Object.entries(
      vectors as Record<string, unknown>,
    );

    for (const [name, value] of namedVectors) {
      if (!value || typeof value !== "object") {
        continue;
      }

      const config = value as {
        size?: unknown;
        distance?: unknown;
      };

      if (typeof config.size === "number") {
        return {
          available: true,
          vectorDimensions: config.size,
          distanceMetric:
            typeof config.distance === "string"
              ? config.distance
              : null,
          vectorName: name,
        };
      }
    }

    return unavailable;
  } catch {
    return unavailable;
  }
}