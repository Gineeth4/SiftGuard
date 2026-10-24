import { createHash } from "node:crypto";
import { ID, Query } from "node-appwrite";

import { appConfig } from "./config";
import { tablesDB } from "./appwrite";
import { embedTexts } from "./embeddings";
import {
  searchVectors,
  upsertVectorPoints,
  type SearchHit,
} from "./qdrant";

const SUITE_ID = "demo_refund_suite";
const TENANT_ID = "demo-tenant";
const OTHER_TENANT_ID = "other-tenant";
const TOP_K = 2;

const APPWRITE_MAX_ATTEMPTS = 3;
const APPWRITE_INITIAL_RETRY_DELAY_MS = 500;

export type DemoScenario =
  | "baseline"
  | "exclude_expected_document"
  | "wrong_tenant_filter";

export interface RunEvaluationOptions {
  scenario?: DemoScenario;
  baselineRunId?: string;
}

interface DemoDocument {
  id: string;
  vectorPointId: string;
  title: string;
  content: string;
  category: string;
  sourceUrl: string;
  tenantId: string;
}

interface DemoRule {
  id: string;
  key: string;
  type: "required" | "forbidden";
  documentId: string;
  testCaseId: string;
  maxRank?: number;
  notes: string;
}

interface DemoCase {
  id: string;
  query: string;
  category: string;
  requiredDocumentId: string;
  forbiddenDocumentIds: string[];
}

interface RowData {
  [key: string]: unknown;
}

interface StoredRule {
  id: string;
  type: "required" | "forbidden";
  documentId: string;
  maxRank?: number;
  notes: string;
}

interface CaseEvaluation {
  testCaseId: string;
  query: string;
  status: "passed" | "failed";
  recallAtK: number;
  reciprocalRank: number;
  forbiddenCount: number;
  latencyMs: number;
  retrieved: Array<{
    documentId: string;
    title: string;
    score: number;
  }>;
  failureCode?: string;
  failureSummary?: string;
}

interface BaselineComparison {
  testCaseId: string;
  query: string;
  baselineStatus: string;
  candidateStatus: string;
  baselineRecallAtK: number;
  candidateRecallAtK: number;
  recallDelta: number;
  baselineReciprocalRank: number;
  candidateReciprocalRank: number;
  reciprocalRankDelta: number;
  baselineLatencyMs: number;
  candidateLatencyMs: number;
  latencyDeltaMs: number;
  baselineForbiddenCount: number;
  candidateForbiddenCount: number;
  regressed: boolean;
  improved: boolean;
}

interface RetryErrorInfo {
  code: number | null;
  message: string;
}

const documents: DemoDocument[] = [
  {
    id: "demo_refund_policy",
    vectorPointId: "11111111-1111-4111-8111-111111111111",
    title: "Refund and Returns Policy",
    category: "policies",
    sourceUrl: "https://example.com/policies/refunds",
    tenantId: TENANT_ID,
    content:
      "Customers may return unused items within 30 days of delivery " +
      "for a refund. To request a refund, open Orders, select Return " +
      "Item, and follow the return instructions. Approved refunds " +
      "are issued to the original payment method after the returned " +
      "item is inspected.",
  },
  {
    id: "demo_shipping_info",
    vectorPointId: "22222222-2222-4222-8222-222222222222",
    title: "Shipping and Delivery Information",
    category: "shipping",
    sourceUrl: "https://example.com/help/shipping",
    tenantId: TENANT_ID,
    content:
      "Standard shipping usually takes three to five business days. " +
      "Customers can track deliveries in the Orders page. Shipping " +
      "delays and delivery updates are shown in the tracking details.",
  },
  {
    id: "demo_warranty_info",
    vectorPointId: "33333333-3333-4333-8333-333333333333",
    title: "Product Warranty",
    category: "warranty",
    sourceUrl: "https://example.com/help/warranty",
    tenantId: TENANT_ID,
    content:
      "Eligible electronics include a one-year limited warranty for " +
      "manufacturing defects. Customers can submit a claim with proof " +
      "of purchase and a description of the issue.",
  },
  {
    id: "demo_account_security",
    vectorPointId: "44444444-4444-4444-8444-444444444444",
    title: "Account Security",
    category: "security",
    sourceUrl: "https://example.com/help/account-security",
    tenantId: TENANT_ID,
    content:
      "Never share your password or one-time verification code. " +
      "Enable multi-factor authentication and contact support if " +
      "you suspect unauthorised access to your account.",
  },
  {
    id: "demo_other_tenant_refund",
    vectorPointId: "55555555-5555-4555-8555-555555555555",
    title: "Customer B Refund Policy",
    category: "policies",
    sourceUrl: "https://example.com/tenant-b/refunds",
    tenantId: OTHER_TENANT_ID,
    content:
      "Customers may return unused items within 30 days of delivery " +
      "for a refund. To request a refund, open Orders, select Return " +
      "Item, and follow the return instructions. Approved refunds " +
      "are issued to the original payment method after the returned " +
      "item is inspected. This policy belongs exclusively to Customer B.",
  },
];

const demoCases: DemoCase[] = [
  {
    id: "demo_refund_case",
    query: "How can I return an order and get my money back?",
    category: "support-policy",
    requiredDocumentId: "demo_refund_policy",
    forbiddenDocumentIds: [
      "demo_account_security",
      "demo_other_tenant_refund",
    ],
  },
  {
    id: "demo_shipping_case",
    query:
      "Where can I check when my package will arrive and track delivery?",
    category: "shipping",
    requiredDocumentId: "demo_shipping_info",
    forbiddenDocumentIds: ["demo_account_security"],
  },
  {
    id: "demo_warranty_case",
    query:
      "What coverage do I get if my electronic device has a manufacturing defect?",
    category: "warranty",
    requiredDocumentId: "demo_warranty_info",
    forbiddenDocumentIds: ["demo_shipping_info"],
  },
];

const demoRules: DemoRule[] = demoCases.flatMap((testCase) => [
  {
    id: `${testCase.id}_required`,
    key:
      `${testCase.id}:required:` +
      `${testCase.requiredDocumentId}:v1`,
    type: "required" as const,
    documentId: testCase.requiredDocumentId,
    testCaseId: testCase.id,
    maxRank: TOP_K,
    notes:
      "The expected document must appear within the top results.",
  },
  ...testCase.forbiddenDocumentIds.map(
    (documentId, index): DemoRule => ({
      id:
        index === 0
          ? `${testCase.id}_forbidden`
          : `${testCase.id}_forbidden_${index}`,
      key:
        `${testCase.id}:forbidden:` +
        `${documentId}:v1`,
      type: "forbidden",
      documentId,
      testCaseId: testCase.id,
      notes:
        "The designated forbidden document must not appear in the results.",
    }),
  ),
]);

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getRetryErrorInfo(error: unknown): RetryErrorInfo {
  const messages: string[] = [];
  const visited = new Set<object>();
  let code: number | null = null;
  let current: unknown = error;

  for (let depth = 0; depth < 5; depth += 1) {
    if (current === null || current === undefined) {
      break;
    }

    if (typeof current === "string") {
      messages.push(current);
      break;
    }

    if (typeof current !== "object") {
      messages.push(String(current));
      break;
    }

    if (visited.has(current)) {
      break;
    }

    visited.add(current);

    const value = current as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      cause?: unknown;
      type?: unknown;
    };

    if (code === null && typeof value.code === "number") {
      code = value.code;
    }

    if (typeof value.name === "string" && value.name.length > 0) {
      messages.push(value.name);
    }

    if (
      typeof value.message === "string" &&
      value.message.length > 0
    ) {
      messages.push(value.message);
    }

    if (typeof value.type === "string" && value.type.length > 0) {
      messages.push(value.type);
    }

    current = value.cause;
  }

  return {
    code,
    message: [...new Set(messages)].join(": ") || "Unknown error",
  };
}

function isRetryableAppwriteError(error: unknown): boolean {
  const info = getRetryErrorInfo(error);

  const nonRetryableCodes = new Set([
    400, 401, 403, 404, 405, 409, 422,
  ]);

  if (info.code !== null && nonRetryableCodes.has(info.code)) {
    return false;
  }

  if (
    info.code === 429 ||
    (info.code !== null && info.code >= 500)
  ) {
    return true;
  }

  return /fetch failed|connecttimeout|connect timeout|timed out|timeout|network|socket|econnreset|econnrefused|etimedout|und_err|temporarily unavailable|connection reset|connection refused/i.test(
    info.message,
  );
}

async function withAppwriteRetry<T>(
  operationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  for (
    let attempt = 1;
    attempt <= APPWRITE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      const info = getRetryErrorInfo(error);
      const canRetry =
        attempt < APPWRITE_MAX_ATTEMPTS &&
        isRetryableAppwriteError(error);

      if (!canRetry) {
        throw error;
      }

      const waitMs =
        APPWRITE_INITIAL_RETRY_DELAY_MS *
        2 ** (attempt - 1);

      console.warn("[SiftGuard] Retrying Appwrite operation.", {
        operation: operationName,
        attempt,
        nextAttempt: attempt + 1,
        waitMs,
        errorCode: info.code,
        error: info.message,
      });

      await delay(waitMs);
    }
  }

  throw new Error(
    `Appwrite operation "${operationName}" exhausted its retries.`,
  );
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
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing or invalid field: ${field}.`);
  }

  return value;
}

function numberValue(value: unknown): number {
  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
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

  throw new Error(
    `Relationship "${field}" did not return a valid row ID.`,
  );
}

async function upsertRow(
  tableId: string,
  rowId: string,
  data: RowData,
): Promise<RowData> {
  return withAppwriteRetry(`upsert ${tableId}/${rowId}`, async () => {
    const result = await tablesDB.upsertRow({
      databaseId: appConfig.databaseId,
      tableId,
      rowId,
      data,
    });

    return asRow(result);
  });
}

async function getRow(
  tableId: string,
  rowId: string,
): Promise<RowData> {
  return withAppwriteRetry(`read ${tableId}/${rowId}`, async () => {
    const result = await tablesDB.getRow({
      databaseId: appConfig.databaseId,
      tableId,
      rowId,
    });

    return asRow(result);
  });
}

async function seedDocuments(): Promise<void> {
  const vectors = await embedTexts(
    documents.map(
      (document) => `${document.title}\n${document.content}`,
    ),
  );

  for (const document of documents) {
    const contentHash = createHash("sha256")
      .update(`${document.title}\n${document.content}`)
      .digest("hex");

    await upsertRow(
      appConfig.tables.documents,
      document.id,
      {
        title: document.title,
        content: document.content,
        source_url: document.sourceUrl,
        tenant_id: document.tenantId,
        category: document.category,
        status: "active",
        version: 1,
        content_hash: contentHash,
        vector_point_id: document.vectorPointId,
      },
    );
  }

  await upsertVectorPoints(
    documents.map((document, index) => {
      const vector = vectors[index];

      if (!vector) {
        throw new Error(`Missing embedding for ${document.id}.`);
      }

      return {
        id: document.vectorPointId,
        vector,
        payload: {
          document_id: document.id,
          title: document.title,
          tenant_id: document.tenantId,
          category: document.category,
          status: "active",
        },
      };
    }),
  );
}

async function seedContracts(): Promise<void> {
  await upsertRow(appConfig.tables.suites, SUITE_ID, {
    name: "Support Search Quality Suite",
    description:
      "Evaluates support, shipping and warranty retrieval, including forbidden-result and tenant-isolation assertions.",
    status: "active",
    min_recall_at_k: 1.0,
    top_k: TOP_K,
  });

  for (const testCase of demoCases) {
    await upsertRow(
      appConfig.tables.cases,
      testCase.id,
      {
        query_text: testCase.query,
        category: testCase.category,
        is_enabled: true,
        tenant_id: TENANT_ID,
        top_k: TOP_K,
        suite: SUITE_ID,
      },
    );
  }

  for (const rule of demoRules) {
    const data: RowData = {
      rule_key: rule.key,
      rule_type: rule.type,
      notes: rule.notes,
      is_active: true,
      test_case: rule.testCaseId,
      document: rule.documentId,
    };

    if (rule.maxRank !== undefined) {
      data.max_rank = rule.maxRank;
    }

    await upsertRow(appConfig.tables.rules, rule.id, data);
  }
}

async function loadStoredCase(
  definition: DemoCase,
): Promise<{
  row: RowData;
  query: string;
  tenantId: string;
  topK: number;
  rules: StoredRule[];
}> {
  const row = await getRow(appConfig.tables.cases, definition.id);

  const query = asString(row.query_text, "query_text");
  const tenantId = asString(row.tenant_id, "tenant_id");
  const topK = Number(row.top_k ?? TOP_K);

  if (!Number.isInteger(topK) || topK < 1 || topK > 100) {
    throw new Error(
      `Invalid top_k for test case ${definition.id}.`,
    );
  }

  const ruleDefinitions = demoRules.filter(
    (rule) => rule.testCaseId === definition.id,
  );

  const ruleRows: RowData[] = [];

  for (const rule of ruleDefinitions) {
    ruleRows.push(await getRow(appConfig.tables.rules, rule.id));
  }

  const rules: StoredRule[] = ruleRows
    .filter((rule) => rule.is_active === true)
    .map((rule) => {
      const type = asString(rule.rule_type, "rule_type");

      if (type !== "required" && type !== "forbidden") {
        throw new Error(`Unsupported rule type: ${type}.`);
      }

      const maxRankValue = rule.max_rank;
      const maxRank =
        typeof maxRankValue === "number" && maxRankValue >= 1
          ? maxRankValue
          : undefined;

      return {
        id: asString(rule.$id, "$id"),
        type,
        documentId: relationId(rule.document, "document"),
        maxRank,
        notes: typeof rule.notes === "string" ? rule.notes : "",
      };
    });

  if (!rules.some((rule) => rule.type === "required")) {
    throw new Error(
      `Test case ${definition.id} has no active required-document rule.`,
    );
  }

  return { row, query, tenantId, topK, rules };
}

async function loadBaseline(
  baselineRunId: string,
): Promise<{
  run: RowData;
  results: RowData[];
}> {
  const run = await getRow(appConfig.tables.runs, baselineRunId);

  if (run.status !== "passed") {
    throw new Error(
      "The baseline run must have passed before it can be used for comparison.",
    );
  }

  if (relationId(run.suite, "suite") !== SUITE_ID) {
    throw new Error(
      "The baseline run does not belong to the current test suite.",
    );
  }

  const response = await withAppwriteRetry(
    "list baseline evaluation results",
    () =>
      tablesDB.listRows({
        databaseId: appConfig.databaseId,
        tableId: appConfig.tables.results,
        queries: [
          Query.orderDesc("$createdAt"),
          Query.limit(500),
        ],
      }),
  );

  const baselineResults = (
    response.rows as unknown as RowData[]
  ).filter((result) => {
    try {
      return relationId(result.run, "run") === baselineRunId;
    } catch {
      return false;
    }
  });

  if (baselineResults.length < demoCases.length) {
    throw new Error(
      "The selected baseline does not contain results for all three demo cases.",
    );
  }

  return { run, results: baselineResults };
}

function compareResults(
  currentResults: CaseEvaluation[],
  baselineRows: RowData[],
): BaselineComparison[] {
  const baselineByCase = new Map<string, RowData>();

  for (const row of baselineRows) {
    try {
      baselineByCase.set(
        relationId(row.test_case, "test_case"),
        row,
      );
    } catch {
      // Ignore rows that cannot be associated with a test case.
    }
  }

  return currentResults.map((current) => {
    const baseline = baselineByCase.get(current.testCaseId);

    if (!baseline) {
      throw new Error(
        `Baseline result missing for ${current.testCaseId}.`,
      );
    }

    const baselineStatus = asString(
      baseline.status,
      "baseline status",
    );
    const baselineRecall = numberValue(baseline.recall_at_k);
    const baselineRank = numberValue(baseline.reciprocal_rank);
    const baselineLatency = numberValue(baseline.latency_ms);
    const baselineForbidden = numberValue(
      baseline.forbidden_count,
    );

    return {
      testCaseId: current.testCaseId,
      query: current.query,
      baselineStatus,
      candidateStatus: current.status,
      baselineRecallAtK: baselineRecall,
      candidateRecallAtK: current.recallAtK,
      recallDelta: current.recallAtK - baselineRecall,
      baselineReciprocalRank: baselineRank,
      candidateReciprocalRank: current.reciprocalRank,
      reciprocalRankDelta:
        current.reciprocalRank - baselineRank,
      baselineLatencyMs: baselineLatency,
      candidateLatencyMs: current.latencyMs,
      latencyDeltaMs: current.latencyMs - baselineLatency,
      baselineForbiddenCount: baselineForbidden,
      candidateForbiddenCount: current.forbiddenCount,
      regressed:
        baselineStatus === "passed" &&
        current.status === "failed",
      improved:
        baselineStatus === "failed" &&
        current.status === "passed",
    };
  });
}

export async function runDemoEvaluation(
  options: RunEvaluationOptions = {},
) {
  const scenario = options.scenario ?? "baseline";
  const baselineRunId = options.baselineRunId?.trim();
  const pipelineStart = Date.now();

  if (scenario !== "baseline" && !baselineRunId) {
    throw new Error(
      "A successful baseline run ID is required for regression scenarios.",
    );
  }

  await seedDocuments();
  await seedContracts();

  const savedSuite = await getRow(
    appConfig.tables.suites,
    SUITE_ID,
  );

  const minimumRecall = Number(savedSuite.min_recall_at_k);

  if (
    !Number.isFinite(minimumRecall) ||
    minimumRecall < 0 ||
    minimumRecall > 1
  ) {
    throw new Error(
      "The saved suite contains an invalid recall threshold.",
    );
  }

  const storedCases: Awaited<
    ReturnType<typeof loadStoredCase>
  >[] = [];

  for (const testCase of demoCases) {
    storedCases.push(await loadStoredCase(testCase));
  }

  const queryVectors = await embedTexts(
    storedCases.map((testCase) => testCase.query),
  );

  let baselineRows: RowData[] = [];

  if (scenario !== "baseline" && baselineRunId) {
    const baseline = await loadBaseline(baselineRunId);
    baselineRows = baseline.results;
  }

  const scenarioDescription =
    scenario === "baseline"
      ? "Baseline evaluation."
      : scenario === "exclude_expected_document"
        ? "Regression simulation: excluded a required document from the Qdrant query."
        : "Regression simulation: used the wrong tenant filter for the refund case.";

  const runData: RowData = {
    suite: SUITE_ID,
    status: "running",
    backend: "qdrant",
    trigger: scenario === "baseline" ? "manual" : "regression",
    total_cases: storedCases.length,
    passed_cases: 0,
    failed_cases: 0,
    pass_rate: 0,
    duration_ms: 0,
    started_at: new Date().toISOString(),
    summary: scenarioDescription,
  };

  if (baselineRunId) {
    runData.baseline_run_id = baselineRunId;
  }

  const runId = ID.unique();

  await upsertRow(appConfig.tables.runs, runId, runData);

  const results: CaseEvaluation[] = [];

  try {
    for (
      let index = 0;
      index < storedCases.length;
      index += 1
    ) {
      const storedCase = storedCases[index];
      const queryVector = queryVectors[index];

      if (!storedCase || !queryVector) {
        throw new Error(
          `Missing test case or query embedding at index ${index}.`,
        );
      }

      const caseId = asString(storedCase.row.$id, "$id");

      const requiredRules = storedCase.rules.filter(
        (rule) => rule.type === "required",
      );
      const forbiddenRules = storedCase.rules.filter(
        (rule) => rule.type === "forbidden",
      );

      const requiredIds = requiredRules.map(
        (rule) => rule.documentId,
      );
      const forbiddenIds = forbiddenRules.map(
        (rule) => rule.documentId,
      );

      const isRefundCase = caseId === "demo_refund_case";

      const appliedTenantId =
        scenario === "wrong_tenant_filter" && isRefundCase
          ? OTHER_TENANT_ID
          : storedCase.tenantId;

      const excludedDocumentIds =
        scenario === "exclude_expected_document" && isRefundCase
          ? requiredIds
          : [];

      const searchStart = Date.now();

      const hits: SearchHit[] = await searchVectors(
        queryVector,
        storedCase.topK,
        storedCase.tenantId,
        {
          ...(excludedDocumentIds.length > 0
            ? { excludeDocumentIds: excludedDocumentIds }
            : {}),
          ...(appliedTenantId !== storedCase.tenantId
            ? { tenantIdOverride: appliedTenantId }
            : {}),
        },
      );

      const latencyMs = Date.now() - searchStart;

      const retrieved = hits.map((hit) => ({
        documentId: String(hit.payload?.document_id ?? ""),
        title: String(hit.payload?.title ?? "Untitled document"),
        score: hit.score,
      }));

      const retrievedIds = retrieved
        .map((item) => item.documentId)
        .filter(Boolean);

      const requiredMatches = requiredIds.filter(
        (id) => retrievedIds.includes(id),
      );

      const forbiddenMatches = retrievedIds.filter(
        (id) => forbiddenIds.includes(id),
      );

      const recallAtK =
        requiredIds.length > 0
          ? requiredMatches.length / requiredIds.length
          : 0;

      const firstRelevantIndex = retrieved.findIndex(
        (item) => requiredIds.includes(item.documentId),
      );

      const reciprocalRank =
        firstRelevantIndex >= 0
          ? 1 / (firstRelevantIndex + 1)
          : 0;

      const rankViolations = requiredRules.filter((rule) => {
        const rank = retrievedIds.indexOf(rule.documentId);

        return (
          rank < 0 ||
          (rule.maxRank !== undefined &&
            rank + 1 > rule.maxRank)
        );
      });

      const passed =
        recallAtK >= minimumRecall &&
        forbiddenMatches.length === 0 &&
        rankViolations.length === 0;

      const failureCode = passed
        ? undefined
        : forbiddenMatches.length > 0
          ? "FORBIDDEN_RESULT_FOUND"
          : rankViolations.length > 0
            ? "REQUIRED_DOCUMENT_RANK_FAILURE"
            : "RECALL_BELOW_THRESHOLD";

      const failureSummary = passed
        ? undefined
        : forbiddenMatches.length > 0
          ? "A forbidden document appeared in the retrieved results."
          : rankViolations.length > 0
            ? "A required document was missing or ranked below its allowed position."
            : `Recall@K was ${recallAtK.toFixed(2)}, below ${minimumRecall.toFixed(2)}.`;

      const trace = {
        testCaseId: caseId,
        query: storedCase.query,
        configuredTenant: storedCase.tenantId,
        appliedTenantFilter: appliedTenantId,
        scenario,
        excludedDocumentIds,
        topK: storedCase.topK,
        minimumRecall,
        requiredRules,
        forbiddenRules,
        requiredMatches,
        forbiddenMatches,
        rankViolations,
        retrieved,
        recallAtK,
        reciprocalRank,
        latencyMs,
        backend: "qdrant",
        embeddingModel: appConfig.embeddingModel,
      };

      const resultData: RowData = {
        run: runId,
        test_case: caseId,
        status: passed ? "passed" : "failed",
        recall_at_k: recallAtK,
        reciprocal_rank: reciprocalRank,
        latency_ms: latencyMs,
        expected_count: requiredIds.length,
        retrieved_count: retrieved.length,
        forbidden_count: forbiddenMatches.length,
        actual_document_ids_json: JSON.stringify(retrievedIds),
        trace_json: JSON.stringify(trace),
      };

      if (failureCode) {
        resultData.failure_code = failureCode;
        resultData.failure_summary = failureSummary;
      }

      const resultId = ID.unique();

      await upsertRow(
        appConfig.tables.results,
        resultId,
        resultData,
      );

      results.push({
        testCaseId: caseId,
        query: storedCase.query,
        status: passed ? "passed" : "failed",
        recallAtK,
        reciprocalRank,
        forbiddenCount: forbiddenMatches.length,
        latencyMs,
        retrieved,
        ...(failureCode
          ? { failureCode, failureSummary }
          : {}),
      });
    }

    const passedCases = results.filter(
      (result) => result.status === "passed",
    ).length;

    const failedCases = results.length - passedCases;
    const allPassed = failedCases === 0;

    const passRate =
      results.length > 0
        ? (passedCases / results.length) * 100
        : 0;

    const durationMs = Date.now() - pipelineStart;

    const comparison =
      scenario !== "baseline"
        ? compareResults(results, baselineRows)
        : [];

    const regressionCount = comparison.filter(
      (item) => item.regressed,
    ).length;

    const summary =
      scenario === "baseline"
        ? allPassed
          ? `Baseline passed all ${results.length} search contracts.`
          : `Baseline failed ${failedCases} of ${results.length} search contracts.`
        : `${scenarioDescription} ` +
          `${regressionCount} test(s) regressed against baseline ${baselineRunId}.`;

    await withAppwriteRetry(
      `update evaluation run ${runId}`,
      () =>
        tablesDB.updateRow({
          databaseId: appConfig.databaseId,
          tableId: appConfig.tables.runs,
          rowId: runId,
          data: {
            status: allPassed ? "passed" : "failed",
            total_cases: results.length,
            passed_cases: passedCases,
            failed_cases: failedCases,
            pass_rate: passRate,
            duration_ms: durationMs,
            finished_at: new Date().toISOString(),
            summary,
          },
        }),
    );

    return {
      status: allPassed ? "passed" : "failed",
      scenario,
      scenarioDescription,
      runId,
      suiteId: SUITE_ID,
      baselineRunId: baselineRunId ?? null,
      backend: "qdrant" as const,
      totalCases: results.length,
      passedCases,
      failedCases,
      passRate,
      durationMs,
      results,
      comparison,
      regressionCount,
    };
  } catch (error) {
    try {
      await withAppwriteRetry(
        `mark evaluation run ${runId} failed`,
        () =>
          tablesDB.updateRow({
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
                  ? `Evaluation infrastructure error: ${error.message}`
                  : "Evaluation infrastructure error.",
            },
          }),
      );
    } catch (statusUpdateError) {
      console.error(
        "[SiftGuard] Could not update failed run status.",
        getRetryErrorInfo(statusUpdateError),
      );
    }

    throw error;
  }
}