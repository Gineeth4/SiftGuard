import { ID } from "node-appwrite";

import { appConfig } from "./config";
import { tablesDB } from "./appwrite";
import { embedTexts } from "./embeddings";
import {
  QDRANT_COLLECTION,
  searchVectors,
  type SearchHit,
} from "./qdrant";
import { listAllTableRows } from "./appwrite-pagination";
import {
  createExperimentSnapshot,
  readQdrantCollectionMetadata,
  type SnapshotCase,
  type CorpusDocumentMetadata,
} from "./experiment-snapshots";
import { evaluateReleaseGate } from "./release-gate";
import {
  evaluateRetrieval,
  meanMetric,
} from "./retrieval-metrics";

type RowData = Record<string, unknown>;
type RuleType = "required" | "forbidden";

interface StoredCase {
  id: string;
  query: string;
  category: string;
  tenantId: string;
  topK: number;
}

interface StoredRule {
  id: string;
  type: RuleType;
  documentId: string;
  maxRank?: number;
  notes: string;
}

function asRow(value: unknown): RowData {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("Appwrite returned an invalid row.");
  }

  return value as RowData;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing or invalid field: ${field}.`);
  }

  return value.trim();
}

function relationId(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    return relationId(value[0], field);
  }

  if (
    value !== null &&
    typeof value === "object" &&
    "$id" in value &&
    typeof (value as { $id?: unknown }).$id === "string"
  ) {
    return (value as { $id: string }).$id;
  }

  throw new Error(`Relationship "${field}" is missing or invalid.`);
}

function optionalRelationId(value: unknown): string {
  try {
    return relationId(value, "relationship");
  } catch {
    return "";
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

async function listRows(tableId: string): Promise<RowData[]> {
  return (
    await listAllTableRows(tableId)
  ).map((row) => asRow(row));
}

async function getRow(
  tableId: string,
  rowId: string,
): Promise<RowData> {
  return asRow(
    await tablesDB.getRow({
      databaseId: appConfig.databaseId,
      tableId,
      rowId,
    }),
  );
}

export async function getContractCatalog() {
  const [
    suiteRows,
    caseRows,
    documentRows,
    ruleRows,
  ] = await Promise.all([
    listRows(appConfig.tables.suites),
    listRows(appConfig.tables.cases),
    listRows(appConfig.tables.documents),
    listRows(appConfig.tables.rules),
  ]);

  const suites = suiteRows.map((row) => ({
    id: asString(row.$id, "$id"),
    name: asString(row.name, "suite.name"),
    description: String(row.description ?? ""),
    status: String(row.status ?? "active"),
    minimumRecallAtK: finiteNumber(row.min_recall_at_k, 1),
    topK: finiteNumber(row.top_k, 3),
  }));

  const documents = documentRows
    .filter((row) => String(row.status ?? "active") === "active")
    .map((row) => ({
      id: asString(row.$id, "$id"),
      title: String(row.title ?? "Untitled document"),
      category: String(row.category ?? "general"),
      tenantId: String(row.tenant_id ?? ""),
      sourceUrl: String(row.source_url ?? ""),
    }));

  const rulesByCase = new Map<string, RowData[]>();

  for (const rule of ruleRows) {
    if (rule.is_active !== true) {
      continue;
    }

    const caseId = optionalRelationId(rule.test_case);

    if (!caseId) {
      continue;
    }

    const current = rulesByCase.get(caseId) ?? [];
    current.push(rule);
    rulesByCase.set(caseId, current);
  }

  const cases = caseRows.map((row) => {
    const id = asString(row.$id, "$id");
    const rules = rulesByCase.get(id) ?? [];

    return {
      id,
      query: String(row.query_text ?? ""),
      category: String(row.category ?? "general"),
      tenantId: String(row.tenant_id ?? ""),
      topK: finiteNumber(row.top_k, 3),
      enabled: row.is_enabled === true,
      suiteId: optionalRelationId(row.suite),
      requiredCount: rules.filter(
        (rule) => rule.rule_type === "required",
      ).length,
      forbiddenCount: rules.filter(
        (rule) => rule.rule_type === "forbidden",
      ).length,
    };
  });

  return { suites, documents, cases };
}

export interface CreateCustomCaseInput {
  suiteId: string;
  query: string;
  category: string;
  tenantId: string;
  topK: number;
  requiredDocumentIds: string[];
  forbiddenDocumentIds: string[];
}

export async function createCustomCase(
  input: CreateCustomCaseInput,
) {
  const query = input.query.trim();
  const category = input.category.trim() || "general";
  const tenantId = input.tenantId.trim();

  const requiredIds = [...new Set(input.requiredDocumentIds)];
  const forbiddenIds = [...new Set(input.forbiddenDocumentIds)];

  if (!query || query.length > 2000) {
    throw new Error(
      "Query must contain between 1 and 2000 characters.",
    );
  }

  if (!tenantId || tenantId.length > 128) {
    throw new Error(
      "Tenant ID must contain between 1 and 128 characters.",
    );
  }

  if (
    !Number.isInteger(input.topK) ||
    input.topK < 1 ||
    input.topK > 100
  ) {
    throw new Error(
      "Top K must be an integer between 1 and 100.",
    );
  }

  if (requiredIds.length === 0) {
    throw new Error("Select at least one required document.");
  }

  if (requiredIds.length + forbiddenIds.length > 100) {
    throw new Error(
      "A test case can contain at most 100 document rules.",
    );
  }

  if (requiredIds.some((id) => forbiddenIds.includes(id))) {
    throw new Error(
      "A document cannot be both required and forbidden in the same case.",
    );
  }

  const [suite, documentRows] = await Promise.all([
    getRow(appConfig.tables.suites, input.suiteId),
    listRows(appConfig.tables.documents),
  ]);

  if (String(suite.status ?? "active") !== "active") {
    throw new Error("The selected suite is not active.");
  }

  const documentMap = new Map(
    documentRows.map((row) => [
      asString(row.$id, "$id"),
      row,
    ]),
  );

  for (const documentId of [...requiredIds, ...forbiddenIds]) {
    const document = documentMap.get(documentId);

    if (
      !document ||
      String(document.status ?? "active") !== "active"
    ) {
      throw new Error(
        `Document "${documentId}" does not exist or is not active.`,
      );
    }
  }

  for (const documentId of requiredIds) {
    const document = documentMap.get(documentId);

    if (String(document?.tenant_id ?? "") !== tenantId) {
      throw new Error(
        `Required document "${documentId}" must belong to tenant "${tenantId}".`,
      );
    }
  }

  const caseId = ID.unique();

  await tablesDB.createRow({
    databaseId: appConfig.databaseId,
    tableId: appConfig.tables.cases,
    rowId: caseId,
    data: {
      query_text: query,
      category,
      is_enabled: true,
      tenant_id: tenantId,
      top_k: input.topK,
      suite: input.suiteId,
    },
  });

  try {
    const ruleInputs: Array<{
      documentId: string;
      type: RuleType;
    }> = [
      ...requiredIds.map((documentId) => ({
        documentId,
        type: "required" as const,
      })),
      ...forbiddenIds.map((documentId) => ({
        documentId,
        type: "forbidden" as const,
      })),
    ];

    for (const ruleInput of ruleInputs) {
      const isRequired = ruleInput.type === "required";

      await tablesDB.createRow({
        databaseId: appConfig.databaseId,
        tableId: appConfig.tables.rules,
        rowId: ID.unique(),
        data: {
          rule_key:
            `${caseId}:${ruleInput.type}:${ruleInput.documentId}`,
          rule_type: ruleInput.type,
          notes: isRequired
            ? "Expected document must be retrieved within its allowed rank."
            : "Forbidden document must never appear in the retrieved results.",
          is_active: true,
          test_case: caseId,
          document: ruleInput.documentId,
          ...(isRequired ? { max_rank: input.topK } : {}),
        },
      });
    }
  } catch (error) {
    try {
      await tablesDB.updateRow({
        databaseId: appConfig.databaseId,
        tableId: appConfig.tables.cases,
        rowId: caseId,
        data: { is_enabled: false },
      });
    } catch {
      // Preserve the original failure.
    }

    throw error;
  }

  return {
    id: caseId,
    query,
    category,
    tenantId,
    topK: input.topK,
    requiredCount: requiredIds.length,
    forbiddenCount: forbiddenIds.length,
  };
}

export async function evaluateCustomSuite(suiteId: string) {
  const suite = await getRow(appConfig.tables.suites, suiteId);

  if (String(suite.status ?? "active") !== "active") {
    throw new Error("The selected suite is not active.");
  }

  const [caseRows, allRuleRows, corpusRows] = await Promise.all([
    listRows(appConfig.tables.cases),
    listRows(appConfig.tables.rules),
    listRows(appConfig.tables.documents),
  ]);

  const enabledCases: StoredCase[] = caseRows
    .filter(
      (row) =>
        row.is_enabled === true &&
        optionalRelationId(row.suite) === suiteId,
    )
    .map((row) => {
      const topK = finiteNumber(
        row.top_k,
        finiteNumber(suite.top_k, 3),
      );

      if (!Number.isInteger(topK) || topK < 1 || topK > 100) {
        throw new Error(
          `Test case "${String(row.$id)}" has invalid top_k.`,
        );
      }

      return {
        id: asString(row.$id, "$id"),
        query: asString(row.query_text, "query_text"),
        category: String(row.category ?? "general"),
        tenantId: asString(row.tenant_id, "tenant_id"),
        topK,
      };
    });

  if (enabledCases.length === 0) {
    throw new Error("This suite has no enabled test cases.");
  }

  const rulesByCase = new Map<string, StoredRule[]>();

  for (const row of allRuleRows) {
    if (row.is_active !== true) {
      continue;
    }

    const caseId = optionalRelationId(row.test_case);
    const type = row.rule_type;

    if (
      !caseId ||
      (type !== "required" && type !== "forbidden")
    ) {
      continue;
    }

    const rule: StoredRule = {
      id: asString(row.$id, "$id"),
      type,
      documentId: relationId(row.document, "document"),
      notes: String(row.notes ?? ""),
      ...(typeof row.max_rank === "number" && row.max_rank >= 1
        ? { maxRank: row.max_rank }
        : {}),
    };

    const current = rulesByCase.get(caseId) ?? [];
    current.push(rule);
    rulesByCase.set(caseId, current);
  }

  const minimumRecall = finiteNumber(suite.min_recall_at_k, 1);

  if (minimumRecall < 0 || minimumRecall > 1) {
    throw new Error(
      "The suite has an invalid minimum recall threshold.",
    );
  }

  const suiteSnapshot = {
    id: suiteId,
    name: String(suite.name ?? suiteId),
    status: String(suite.status ?? "active"),
    minimumRecallAtK: minimumRecall,
    topK: finiteNumber(suite.top_k, 3),
  };

  const snapshotCases: SnapshotCase[] = enabledCases.map(
    (testCase) => {
      const rules = rulesByCase.get(testCase.id) ?? [];

      return {
        id: testCase.id,
        query: testCase.query,
        category: testCase.category,
        tenantId: testCase.tenantId,
        topK: testCase.topK,
        requiredRules: rules
          .filter((rule) => rule.type === "required")
          .map((rule) => ({
            documentId: rule.documentId,
            ...(rule.maxRank !== undefined
              ? { maxRank: rule.maxRank }
              : {}),
          })),
        forbiddenRules: rules
          .filter((rule) => rule.type === "forbidden")
          .map((rule) => ({
            documentId: rule.documentId,
          })),
      };
    },
  );

  const corpusDocuments: CorpusDocumentMetadata[] = corpusRows.map(
    (row) => ({
      id: asString(row.$id, "$id"),
      title: String(row.title ?? "Untitled document"),
      category: String(row.category ?? "general"),
      tenantId: String(row.tenant_id ?? ""),
      status: String(row.status ?? "active"),
      updatedAt:
        typeof row.$updatedAt === "string"
          ? row.$updatedAt
          : null,
    }),
  );

  const qdrantMetadata = await readQdrantCollectionMetadata(
    appConfig.qdrantUrl,
    QDRANT_COLLECTION,
  );

  const pipelineStart = Date.now();

  const runRecord = await tablesDB.createRow({
    databaseId: appConfig.databaseId,
    tableId: appConfig.tables.runs,
    rowId: ID.unique(),
    data: {
      suite: suiteId,
      status: "running",
      backend: "qdrant",
      trigger: "manual",
      total_cases: enabledCases.length,
      passed_cases: 0,
      failed_cases: 0,
      pass_rate: 0,
      duration_ms: 0,
      started_at: new Date().toISOString(),
      summary: "Custom contract evaluation is running.",
    },
  });

  const runId = asString(asRow(runRecord).$id, "$id");
  const results: Array<Record<string, unknown>> = [];

  try {
    const experimentSnapshot = createExperimentSnapshot({
      runId,
      suite: suiteSnapshot,
      cases: snapshotCases,
      corpusDocuments,
      embeddingModel: appConfig.embeddingModel,
      qdrantCollection: QDRANT_COLLECTION,
      qdrantMetadata,
      appBuild:
        process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.GITHUB_SHA ??
        null,
    });

    const vectors = await embedTexts(
      enabledCases.map((testCase) => testCase.query),
    );

    for (let index = 0; index < enabledCases.length; index += 1) {
      const testCase = enabledCases[index];
      const queryVector = vectors[index];

      if (!testCase || !queryVector) {
        throw new Error(
          `Missing query embedding at index ${index}.`,
        );
      }

      const rules = rulesByCase.get(testCase.id) ?? [];
      const requiredRules = rules.filter(
        (rule) => rule.type === "required",
      );
      const forbiddenRules = rules.filter(
        (rule) => rule.type === "forbidden",
      );

      if (requiredRules.length === 0) {
        throw new Error(
          `Test case "${testCase.id}" has no active required-document rules.`,
        );
      }

      const searchStart = Date.now();

      const hits: SearchHit[] = await searchVectors(
        queryVector,
        testCase.topK,
        testCase.tenantId,
      );

      const latencyMs = Date.now() - searchStart;

      for (const hit of hits) {
        if (
          typeof hit.payload?.document_id !== "string" ||
          hit.payload.document_id.trim().length === 0
        ) {
          throw new Error(
            "Qdrant returned a result without a valid document_id payload.",
          );
        }
      }

      const retrieved = hits.map((hit) => ({
        documentId: String(hit.payload?.document_id),
        title: String(hit.payload?.title ?? "Untitled document"),
        score: hit.score,
      }));

      const retrievedIds = retrieved.map(
        (item) => item.documentId,
      );

      const requiredIds = [
        ...new Set(requiredRules.map((rule) => rule.documentId)),
      ];

      const forbiddenIds = [
        ...new Set(forbiddenRules.map((rule) => rule.documentId)),
      ];

      const metricResult = evaluateRetrieval({
        retrieved: hits.map((hit) => ({
          documentId: String(hit.payload?.document_id),
          score: hit.score,
          tenantId:
            typeof hit.payload?.tenant_id === "string"
              ? hit.payload.tenant_id
              : null,
        })),
        requiredDocumentIds: requiredIds,
        forbiddenDocumentIds: forbiddenIds,
        expectedTenantId: testCase.tenantId,
        topK: testCase.topK,
        thresholds: {
          minRecallAtK: minimumRecall,
          maxForbiddenViolations: 0,
          maxTenantViolations: 0,
        },
      });

      const requiredMatches = requiredIds.filter((id) =>
        retrievedIds.includes(id),
      );

      const forbiddenMatches =
        metricResult.forbiddenViolations.map(
          (violation) => violation.documentId,
        );

      const rankViolations = requiredRules.filter((rule) => {
        const rank = retrievedIds.indexOf(rule.documentId);

        return (
          rank < 0 ||
          (rule.maxRank !== undefined && rank + 1 > rule.maxRank)
        );
      });

      const passed =
        metricResult.decision === "passed" &&
        rankViolations.length === 0;

      const failureCode = passed
        ? undefined
        : metricResult.tenantViolations.length > 0
          ? "TENANT_ISOLATION_VIOLATION"
          : metricResult.unknownTenantCount > 0
            ? "TENANT_METADATA_MISSING"
            : forbiddenMatches.length > 0
              ? "FORBIDDEN_RESULT_FOUND"
              : rankViolations.length > 0
                ? "REQUIRED_DOCUMENT_RANK_FAILURE"
                : metricResult.recallAtK !== null &&
                    metricResult.recallAtK < minimumRecall
                  ? "RECALL_BELOW_THRESHOLD"
                  : "EVALUATION_INCONCLUSIVE";

      const failureSummary = passed
        ? undefined
        : [
            ...metricResult.reasons,
            ...(rankViolations.length > 0
              ? [
                  `Required documents missing or beyond allowed rank: ${
                    rankViolations
                      .map((rule) => rule.documentId)
                      .join(", ")
                  }.`,
                ]
              : []),
          ].join(" ") || "The evaluation did not satisfy all release requirements.";

      const evaluatedContract = {
        testCaseId: testCase.id,
        query: testCase.query,
        category: testCase.category,
        tenantId: testCase.tenantId,
        topK: testCase.topK,
        requiredRules,
        forbiddenRules,
      };

      const trace = {
        testCaseId: testCase.id,
        evaluatedContract,
        experimentSnapshot,
        retrieved,
        requiredMatches,
        forbiddenMatches,
        rankViolations,
        recallAtK: metricResult.recallAtK,
        precisionAtK: metricResult.precisionAtK,
        reciprocalRank: metricResult.reciprocalRank,
        ndcgAtK: metricResult.ndcgAtK,
        forbiddenViolations: metricResult.forbiddenViolations,
        tenantViolations: metricResult.tenantViolations,
        unknownTenantCount: metricResult.unknownTenantCount,
        metricDecision: metricResult.decision,
        metricReasons: metricResult.reasons,
        latencyMs,
        backend: "qdrant",
        embeddingModel: appConfig.embeddingModel,
      };

      await tablesDB.createRow({
        databaseId: appConfig.databaseId,
        tableId: appConfig.tables.results,
        rowId: ID.unique(),
        data: {
          run: runId,
          test_case: testCase.id,
          status: passed ? "passed" : "failed",
          recall_at_k: metricResult.recallAtK ?? 0,
          reciprocal_rank: metricResult.reciprocalRank ?? 0,
          latency_ms: latencyMs,
          expected_count: requiredIds.length,
          retrieved_count: retrieved.length,
          forbidden_count: forbiddenMatches.length,
          actual_document_ids_json: JSON.stringify(retrievedIds),
          trace_json: JSON.stringify(trace),
          ...(failureCode ? { failure_code: failureCode } : {}),
          ...(failureSummary
            ? { failure_summary: failureSummary }
            : {}),
        },
      });

      results.push({
        testCaseId: testCase.id,
        query: testCase.query,
        status: passed ? "passed" : "failed",
        recallAtK: metricResult.recallAtK,
        precisionAtK: metricResult.precisionAtK,
        reciprocalRank: metricResult.reciprocalRank,
        ndcgAtK: metricResult.ndcgAtK,
        metricDecision: metricResult.decision,
        forbiddenCount: forbiddenMatches.length,
        matchedForbiddenDocuments: retrieved.filter((item) =>
          forbiddenIds.includes(item.documentId),
        ),
        matchedForbiddenRules: forbiddenRules
          .filter((rule) =>
            forbiddenMatches.includes(rule.documentId),
          )
          .map((rule) => ({
            id: rule.id,
            documentId: rule.documentId,
            notes: rule.notes,
          })),
        tenantViolations: metricResult.tenantViolations,
        unknownTenantCount: metricResult.unknownTenantCount,
        latencyMs,
        retrieved,
        ...(failureCode ? { failureCode } : {}),
        ...(failureSummary ? { failureSummary } : {}),
      });
    }

    const releaseGate = evaluateReleaseGate({
      expectedCaseCount: enabledCases.length,
      completedCaseCount: results.length,
      results: results.map((result) => ({
        testCaseId: String(result.testCaseId ?? ""),
        status: String(result.status ?? ""),
        metricDecision: String(result.metricDecision ?? ""),
        forbiddenCount: Number(result.forbiddenCount ?? 0),
        tenantViolations: Array.isArray(result.tenantViolations)
          ? result.tenantViolations
          : [],
        unknownTenantCount: Number(result.unknownTenantCount ?? 0),
      })),
    });

    const passedCases = results.filter(
      (result) => result.status === "passed",
    ).length;

    const failedCases = results.length - passedCases;
    const passRate = (passedCases / results.length) * 100;
    const durationMs = Date.now() - pipelineStart;

    const status =
      releaseGate.decision === "passed" ? "passed" : "failed";

    const meanRecallAtK = meanMetric(
      results.map((result) =>
        typeof result.recallAtK === "number"
          ? result.recallAtK
          : null,
      ),
    );

    const meanPrecisionAtK = meanMetric(
      results.map((result) =>
        typeof result.precisionAtK === "number"
          ? result.precisionAtK
          : null,
      ),
    );

    const meanReciprocalRank = meanMetric(
      results.map((result) =>
        typeof result.reciprocalRank === "number"
          ? result.reciprocalRank
          : null,
      ),
    );

    const meanNdcgAtK = meanMetric(
      results.map((result) =>
        typeof result.ndcgAtK === "number"
          ? result.ndcgAtK
          : null,
      ),
    );

    const formatMetric = (value: number | null) =>
      value === null ? "unavailable" : value.toFixed(3);

    const aggregateSummary = [
      `Mean Recall@K: ${formatMetric(meanRecallAtK)}`,
      `Mean Precision@K: ${formatMetric(meanPrecisionAtK)}`,
      `MRR: ${formatMetric(meanReciprocalRank)}`,
      `Mean nDCG@K: ${formatMetric(meanNdcgAtK)}`,
      `Snapshot config:${experimentSnapshot.fingerprints.configurationFingerprint.slice(0, 12)}`,
      `contract:${experimentSnapshot.fingerprints.contractFingerprint.slice(0, 12)}`,
      `corpus:${experimentSnapshot.fingerprints.corpusFingerprint.slice(0, 12)}`,
    ].join("; ");

    await tablesDB.updateRow({
      databaseId: appConfig.databaseId,
      tableId: appConfig.tables.runs,
      rowId: runId,
      data: {
        status,
        total_cases: results.length,
        passed_cases: passedCases,
        failed_cases: failedCases,
        pass_rate: passRate,
        duration_ms: durationMs,
        finished_at: new Date().toISOString(),
        summary:
          `${releaseGate.decision.toUpperCase()}: ${failedCases} failed. ` +
          aggregateSummary,
      },
    });

    return {
      status,
      runId,
      suiteId,
      suiteName: String(suite.name ?? suiteId),
      totalCases: results.length,
      passedCases,
      failedCases,
      passRate,
      durationMs,
      meanRecallAtK,
      meanPrecisionAtK,
      meanReciprocalRank,
      meanNdcgAtK,
      releaseGate,
      experimentSnapshot: {
        schemaVersion: experimentSnapshot.schemaVersion,
        capturedAt: experimentSnapshot.capturedAt,
        fingerprints: experimentSnapshot.fingerprints,
        corpus: experimentSnapshot.corpus,
        configuration: experimentSnapshot.configuration,
      },
      results,
    };
  } catch (error) {
    try {
      await tablesDB.updateRow({
        databaseId: appConfig.databaseId,
        tableId: appConfig.tables.runs,
        rowId: runId,
        data: {
          status: "failed",
          failed_cases: Math.max(1, results.length),
          duration_ms: Date.now() - pipelineStart,
          finished_at: new Date().toISOString(),
          summary:
            error instanceof Error
              ? `Contract evaluation error: ${error.message}`
              : "Contract evaluation error.",
        },
      });
    } catch {
      // Preserve the original evaluation failure.
    }

    throw error;
  }
}
