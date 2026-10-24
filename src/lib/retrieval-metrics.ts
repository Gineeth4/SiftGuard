export interface RetrievedDocument {
  documentId: string;
  score?: number | null;
  tenantId?: string | null;
}

export interface RetrievalThresholds {
  minRecallAtK?: number;
  minPrecisionAtK?: number;
  minReciprocalRank?: number;
  minNdcgAtK?: number;
  maxForbiddenViolations?: number;
  maxTenantViolations?: number;
}

export interface RetrievalMetricsInput {
  retrieved: readonly RetrievedDocument[];
  requiredDocumentIds: readonly string[];
  forbiddenDocumentIds?: readonly string[];
  gradedRelevance?: Readonly<Record<string, number>>;
  expectedTenantId?: string;
  topK: number;
  thresholds?: RetrievalThresholds;
}

export interface DocumentViolation {
  documentId: string;
  rank: number;
  score: number | null;
}

export interface TenantViolation extends DocumentViolation {
  actualTenantId: string;
  expectedTenantId: string;
}

export interface RetrievalMetrics {
  topK: number;
  retrievedCount: number;
  recallAtK: number | null;
  precisionAtK: number | null;
  reciprocalRank: number | null;
  ndcgAtK: number | null;
  forbiddenViolations: DocumentViolation[];
  tenantViolations: TenantViolation[];
  unknownTenantCount: number;
  decision: "passed" | "failed" | "inconclusive";
  reasons: string[];
}

function normalizeIds(
  values: readonly string[],
  fieldName: string,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${fieldName} must contain non-empty strings.`);
    }

    const id = value.trim();

    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  return result;
}

function validateThresholds(
  thresholds: RetrievalThresholds,
): void {
  const minimums = [
    ["minRecallAtK", thresholds.minRecallAtK],
    ["minPrecisionAtK", thresholds.minPrecisionAtK],
    ["minReciprocalRank", thresholds.minReciprocalRank],
    ["minNdcgAtK", thresholds.minNdcgAtK],
  ] as const;

  for (const [name, value] of minimums) {
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < 0 || value > 1)
    ) {
      throw new Error(`${name} must be a number between 0 and 1.`);
    }
  }

  const maximums = [
    ["maxForbiddenViolations", thresholds.maxForbiddenViolations],
    ["maxTenantViolations", thresholds.maxTenantViolations],
  ] as const;

  for (const [name, value] of maximums) {
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < 0)
    ) {
      throw new Error(`${name} must be a non-negative integer.`);
    }
  }
}

function validateGrades(
  grades: Readonly<Record<string, number>> | undefined,
): void {
  if (grades === undefined) {
    return;
  }

  for (const [documentId, grade] of Object.entries(grades)) {
    if (documentId.trim().length === 0) {
      throw new Error("Graded relevance contains an empty document ID.");
    }

    if (!Number.isInteger(grade) || grade < 0 || grade > 3) {
      throw new Error(
        `Relevance grade for "${documentId}" must be an integer from 0 to 3.`,
      );
    }
  }
}

function normalizeRetrieved(
  documents: readonly RetrievedDocument[],
): RetrievedDocument[] {
  const seen = new Set<string>();
  const normalized: RetrievedDocument[] = [];

  for (const document of documents) {
    if (
      !document ||
      typeof document.documentId !== "string" ||
      document.documentId.trim().length === 0
    ) {
      throw new Error(
        "Every retrieved document must contain a valid documentId.",
      );
    }

    if (
      document.score !== undefined &&
      document.score !== null &&
      !Number.isFinite(document.score)
    ) {
      throw new Error(
        `Invalid retrieval score for document "${document.documentId}".`,
      );
    }

    const documentId = document.documentId.trim();

    // A duplicate document must not improve precision or recall.
    // Retain its first occurrence because that is its highest rank.
    if (seen.has(documentId)) {
      continue;
    }

    seen.add(documentId);
    normalized.push({
      ...document,
      documentId,
    });
  }

  return normalized;
}

function calculateNdcgAtK(
  retrievedDocumentIds: readonly string[],
  topK: number,
  grades: Readonly<Record<string, number>> | undefined,
): number | null {
  if (!grades || Object.keys(grades).length === 0) {
    return null;
  }

  const topIds = retrievedDocumentIds.slice(0, topK);

  // Missing judgments are unknown, not an invented relevance grade.
  for (const documentId of topIds) {
    if (!Object.prototype.hasOwnProperty.call(grades, documentId)) {
      return null;
    }
  }

  const dcg = topIds.reduce((sum, documentId, index) => {
    const grade = grades[documentId];
    const rank = index + 1;

    return sum + (2 ** grade - 1) / Math.log2(rank + 1);
  }, 0);

  const idealGrades = Object.values(grades)
    .sort((a, b) => b - a)
    .slice(0, topK);

  const idealDcg = idealGrades.reduce((sum, grade, index) => {
    const rank = index + 1;

    return sum + (2 ** grade - 1) / Math.log2(rank + 1);
  }, 0);

  if (idealDcg === 0) {
    return null;
  }

  return dcg / idealDcg;
}

export function evaluateRetrieval(
  input: RetrievalMetricsInput,
): RetrievalMetrics {
  const {
    retrieved,
    topK,
    thresholds = {},
    gradedRelevance,
    expectedTenantId,
  } = input;

  if (!Number.isInteger(topK) || topK < 1 || topK > 100) {
    throw new Error("topK must be an integer between 1 and 100.");
  }

  validateThresholds(thresholds);
  validateGrades(gradedRelevance);

  const requiredIds = normalizeIds(
    input.requiredDocumentIds,
    "requiredDocumentIds",
  );

  const forbiddenIds = new Set(
    normalizeIds(
      input.forbiddenDocumentIds ?? [],
      "forbiddenDocumentIds",
    ),
  );

  for (const documentId of requiredIds) {
    if (forbiddenIds.has(documentId)) {
      throw new Error(
        `Document "${documentId}" cannot be both required and forbidden.`,
      );
    }
  }

  const normalizedResults = normalizeRetrieved(retrieved);
  const topResults = normalizedResults.slice(0, topK);
  const rankedIds = topResults.map((result) => result.documentId);

  const gradedRelevantIds = Object.entries(gradedRelevance ?? {})
    .filter(([, grade]) => grade > 0)
    .map(([documentId]) => documentId);

  const relevantIds = new Set([
    ...requiredIds,
    ...gradedRelevantIds,
  ]);

  const hasRelevanceJudgments =
    requiredIds.length > 0 ||
    (gradedRelevance !== undefined &&
      Object.keys(gradedRelevance).length > 0);

  const retrievedRequiredCount = requiredIds.filter(
    (id) => rankedIds.includes(id),
  ).length;

  const retrievedRelevantCount = rankedIds.filter(
    (id) => relevantIds.has(id),
  ).length;

  const recallAtK =
    requiredIds.length === 0
      ? null
      : retrievedRequiredCount / requiredIds.length;

  // K remains the denominator when fewer than K results are returned.
  const precisionAtK = hasRelevanceJudgments
    ? retrievedRelevantCount / topK
    : null;

  const firstRelevantIndex = rankedIds.findIndex(
    (id) => relevantIds.has(id),
  );

  const reciprocalRank = !hasRelevanceJudgments
    ? null
    : firstRelevantIndex === -1
      ? 0
      : 1 / (firstRelevantIndex + 1);

  const ndcgAtK = calculateNdcgAtK(
    rankedIds,
    topK,
    gradedRelevance,
  );

  const forbiddenViolations: DocumentViolation[] = topResults
    .flatMap((result, index) => {
      if (!forbiddenIds.has(result.documentId)) {
        return [];
      }

      return [{
        documentId: result.documentId,
        rank: index + 1,
        score: result.score ?? null,
      }];
    });

  const tenantViolations: TenantViolation[] = [];
  let unknownTenantCount = 0;

  if (expectedTenantId !== undefined) {
    if (expectedTenantId.trim().length === 0) {
      throw new Error("expectedTenantId cannot be empty.");
    }

    for (let index = 0; index < topResults.length; index += 1) {
      const result = topResults[index];
      const actualTenantId = result.tenantId?.trim();

      if (!actualTenantId) {
        unknownTenantCount += 1;
        continue;
      }

      if (actualTenantId !== expectedTenantId) {
        tenantViolations.push({
          documentId: result.documentId,
          rank: index + 1,
          score: result.score ?? null,
          actualTenantId,
          expectedTenantId,
        });
      }
    }
  }

  const failures: string[] = [];
  const inconclusive: string[] = [];

  if (!hasRelevanceJudgments) {
    inconclusive.push(
      "No relevance judgments were supplied; retrieval-quality metrics are unavailable.",
    );
  }

  if (
    thresholds.minRecallAtK !== undefined &&
    (recallAtK === null || recallAtK < thresholds.minRecallAtK)
  ) {
    if (recallAtK === null) {
      inconclusive.push(
        "Recall@K was required but no required documents were configured.",
      );
    } else {
      failures.push(
        `Recall@K ${recallAtK.toFixed(4)} is below ${thresholds.minRecallAtK}.`,
      );
    }
  }

  if (
    thresholds.minPrecisionAtK !== undefined &&
    (precisionAtK === null ||
      precisionAtK < thresholds.minPrecisionAtK)
  ) {
    if (precisionAtK === null) {
      inconclusive.push(
        "Precision@K was required but relevance judgments are unavailable.",
      );
    } else {
      failures.push(
        `Precision@K ${precisionAtK.toFixed(4)} is below ${thresholds.minPrecisionAtK}.`,
      );
    }
  }

  if (
    thresholds.minReciprocalRank !== undefined &&
    (reciprocalRank === null ||
      reciprocalRank < thresholds.minReciprocalRank)
  ) {
    if (reciprocalRank === null) {
      inconclusive.push(
        "Reciprocal rank was required but relevance judgments are unavailable.",
      );
    } else {
      failures.push(
        `Reciprocal rank ${reciprocalRank.toFixed(4)} is below ${thresholds.minReciprocalRank}.`,
      );
    }
  }

  if (
    thresholds.minNdcgAtK !== undefined &&
    (ndcgAtK === null || ndcgAtK < thresholds.minNdcgAtK)
  ) {
    if (ndcgAtK === null) {
      inconclusive.push(
        "nDCG@K was required but graded relevance judgments are unavailable.",
      );
    } else {
      failures.push(
        `nDCG@K ${ndcgAtK.toFixed(4)} is below ${thresholds.minNdcgAtK}.`,
      );
    }
  }

  const maxForbidden = thresholds.maxForbiddenViolations ?? 0;
  const maxTenant = thresholds.maxTenantViolations ?? 0;

  if (forbiddenViolations.length > maxForbidden) {
    failures.push(
      `${forbiddenViolations.length} forbidden-document violation(s) exceeded the allowed maximum of ${maxForbidden}.`,
    );
  }

  if (tenantViolations.length > maxTenant) {
    failures.push(
      `${tenantViolations.length} tenant-isolation violation(s) exceeded the allowed maximum of ${maxTenant}.`,
    );
  }

  if (unknownTenantCount > 0) {
    inconclusive.push(
      `${unknownTenantCount} retrieved document(s) lacked tenant metadata, so isolation could not be fully verified.`,
    );
  }

  const decision =
    failures.length > 0
      ? "failed"
      : inconclusive.length > 0
        ? "inconclusive"
        : "passed";

  return {
    topK,
    retrievedCount: topResults.length,
    recallAtK,
    precisionAtK,
    reciprocalRank,
    ndcgAtK,
    forbiddenViolations,
    tenantViolations,
    unknownTenantCount,
    decision,
    reasons: [...failures, ...inconclusive],
  };
}

export function meanMetric(
  values: readonly (number | null | undefined)[],
): number | null {
  const available = values.filter(
    (value): value is number =>
      value !== null &&
      value !== undefined &&
      Number.isFinite(value),
  );

  if (available.length === 0) {
    return null;
  }

  return available.reduce((sum, value) => sum + value, 0) /
    available.length;
}