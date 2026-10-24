export interface SnapshotFingerprints {
  configurationFingerprint: string;
  contractFingerprint: string;
  corpusFingerprint: string;
}

export interface ComparableMetrics {
  recallAtK: number | null;
  precisionAtK: number | null;
  reciprocalRank: number | null;
  ndcgAtK: number | null;
  latencyMs: number | null;
}

export interface ComparableCase {
  testCaseId: string;
  query?: string;
  status: string;
  metrics: ComparableMetrics;
  forbiddenCount: number;
  tenantViolationCount: number;
  snapshot?: {
    fingerprints?: SnapshotFingerprints;
  } | null;
}

export interface ComparableRun {
  runId: string;
  suiteId: string;
  status: string;
  cases: ComparableCase[];
}

export interface MetricDelta {
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
}

export type CaseComparisonStatus =
  | "regressed"
  | "improved"
  | "stable"
  | "still_failing"
  | "inconclusive";

export interface CaseComparison {
  testCaseId: string;
  query?: string;
  status: CaseComparisonStatus;
  baselineStatus: string | null;
  candidateStatus: string | null;
  metrics: Record<keyof ComparableMetrics, MetricDelta>;
  reasons: string[];
}

const QUALITY_REGRESSION_THRESHOLD = 0.05;
const LATENCY_WARNING_FACTOR = 1.5;

function delta(
  baseline: number | null,
  candidate: number | null,
): MetricDelta {
  return {
    baseline,
    candidate,
    delta:
      baseline === null || candidate === null
        ? null
        : candidate - baseline,
  };
}

function metricDeltas(
  baseline: ComparableMetrics,
  candidate: ComparableMetrics,
): Record<keyof ComparableMetrics, MetricDelta> {
  return {
    recallAtK: delta(
      baseline.recallAtK,
      candidate.recallAtK,
    ),
    precisionAtK: delta(
      baseline.precisionAtK,
      candidate.precisionAtK,
    ),
    reciprocalRank: delta(
      baseline.reciprocalRank,
      candidate.reciprocalRank,
    ),
    ndcgAtK: delta(
      baseline.ndcgAtK,
      candidate.ndcgAtK,
    ),
    latencyMs: delta(
      baseline.latencyMs,
      candidate.latencyMs,
    ),
  };
}

function compareCase(
  baseline: ComparableCase | undefined,
  candidate: ComparableCase | undefined,
): CaseComparison {
  const testCaseId =
    candidate?.testCaseId ??
    baseline?.testCaseId ??
    "unknown-case";

  const baselineStatus = baseline?.status ?? null;
  const candidateStatus = candidate?.status ?? null;

  const emptyMetrics: ComparableMetrics = {
    recallAtK: null,
    precisionAtK: null,
    reciprocalRank: null,
    ndcgAtK: null,
    latencyMs: null,
  };

  const metrics = metricDeltas(
    baseline?.metrics ?? emptyMetrics,
    candidate?.metrics ?? emptyMetrics,
  );

  if (!baseline || !candidate) {
    return {
      testCaseId,
      query: candidate?.query ?? baseline?.query,
      status: "inconclusive",
      baselineStatus,
      candidateStatus,
      metrics,
      reasons: [
        !baseline
          ? "Case was absent from the baseline; its change cannot be evaluated."
          : "Case was absent from the candidate; its change cannot be evaluated.",
      ],
    };
  }

  const regressionReasons: string[] = [];
  const notes: string[] = [];

  const securityIncreased =
    candidate.forbiddenCount > baseline.forbiddenCount ||
    candidate.tenantViolationCount > baseline.tenantViolationCount;

  if (
    baseline.status === "passed" &&
    candidate.status !== "passed"
  ) {
    regressionReasons.push(
      "Candidate changed a passing case into a failing case.",
    );
  }

  if (securityIncreased) {
    regressionReasons.push(
      "Candidate increased forbidden-document or tenant-isolation violations.",
    );
  }

  const qualityMetrics = [
    ["Recall@K", metrics.recallAtK],
    ["Precision@K", metrics.precisionAtK],
    ["Reciprocal rank", metrics.reciprocalRank],
    ["nDCG@K", metrics.ndcgAtK],
  ] as const;

  for (const [name, metric] of qualityMetrics) {
    const change = metric.delta;

    if (
      change !== null &&
      change < -QUALITY_REGRESSION_THRESHOLD
    ) {
      regressionReasons.push(
        `${name} dropped by ${Math.abs(change).toFixed(3)} ` +
          `(baseline ${metric.baseline?.toFixed(3)}, ` +
          `candidate ${metric.candidate?.toFixed(3)}).`,
      );
    }
  }

  /*
   * Latency is intentionally not a hard classification rule here.
   * A single measurement is sensitive to warm-up, scheduling,
   * network variance, embedding cache state, and background load.
   *
   * We preserve the observed latency delta for inspection, but require
   * repeated measurements and an explicit performance policy before
   * declaring a latency regression.
   */
  const baselineLatency = baseline.metrics.latencyMs;
  const candidateLatency = candidate.metrics.latencyMs;

  if (
    baselineLatency !== null &&
    candidateLatency !== null &&
    baselineLatency > 0 &&
    candidateLatency > baselineLatency * LATENCY_WARNING_FACTOR
  ) {
    notes.push(
      `Observed latency increased from ${baselineLatency} ms to ` +
        `${candidateLatency} ms. This single measurement is a warning, ` +
        "not a confirmed performance regression; repeat the benchmark.",
    );
  }

  const improvedMetrics = qualityMetrics.filter(
    ([, metric]) =>
      metric.delta !== null &&
      metric.delta >= QUALITY_REGRESSION_THRESHOLD,
  );

  let status: CaseComparisonStatus;

  if (regressionReasons.length > 0) {
    status = "regressed";
  } else if (
    baseline.status !== "passed" &&
    candidate.status === "passed"
  ) {
    status = "improved";
  } else if (
    baseline.status !== "passed" &&
    candidate.status !== "passed"
  ) {
    status = "still_failing";
  } else if (improvedMetrics.length > 0) {
    status = "improved";
  } else {
    status = "stable";
  }

  return {
    testCaseId,
    query: candidate.query,
    status,
    baselineStatus,
    candidateStatus,
    metrics,
    reasons: regressionReasons.length > 0
      ? regressionReasons
      : notes,
  };
}

export function compareEvaluationRuns(
  baseline: ComparableRun,
  candidate: ComparableRun,
) {
  const baselineByCase = new Map(
    baseline.cases.map((item) => [
      item.testCaseId,
      item,
    ]),
  );

  const candidateByCase = new Map(
    candidate.cases.map((item) => [
      item.testCaseId,
      item,
    ]),
  );

  const caseIds = [
    ...new Set([
      ...baselineByCase.keys(),
      ...candidateByCase.keys(),
    ]),
  ].sort();

  const cases = caseIds.map((id) =>
    compareCase(
      baselineByCase.get(id),
      candidateByCase.get(id),
    ),
  );

  const baselineSnapshot = baseline.cases.find(
    (item) => item.snapshot?.fingerprints,
  )?.snapshot?.fingerprints;

  const candidateSnapshot = candidate.cases.find(
    (item) => item.snapshot?.fingerprints,
  )?.snapshot?.fingerprints;

  const drift = {
    available: Boolean(
      baselineSnapshot && candidateSnapshot,
    ),
    configurationChanged:
      baselineSnapshot && candidateSnapshot
        ? baselineSnapshot.configurationFingerprint !==
          candidateSnapshot.configurationFingerprint
        : null,
    contractsChanged:
      baselineSnapshot && candidateSnapshot
        ? baselineSnapshot.contractFingerprint !==
          candidateSnapshot.contractFingerprint
        : null,
    corpusMetadataChanged:
      baselineSnapshot && candidateSnapshot
        ? baselineSnapshot.corpusFingerprint !==
          candidateSnapshot.corpusFingerprint
        : null,
  };

  const regressionCount = cases.filter(
    (item) => item.status === "regressed",
  ).length;

  const improvedCount = cases.filter(
    (item) => item.status === "improved",
  ).length;

  const inconclusiveCount = cases.filter(
    (item) =>
      item.status === "inconclusive" ||
      item.status === "still_failing",
  ).length;

  const status =
    regressionCount > 0
      ? "regressed"
      : inconclusiveCount > 0 || !drift.available
        ? "inconclusive"
        : improvedCount > 0
          ? "improved"
          : "stable";

  return {
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    suiteId: candidate.suiteId,
    status,
    regressionCount,
    improvedCount,
    inconclusiveCount,
    drift,
    cases,
  };
}