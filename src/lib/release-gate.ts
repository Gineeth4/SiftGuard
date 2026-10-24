export type ReleaseDecision =
  | "passed"
  | "failed"
  | "inconclusive";

export interface ReleaseGateCase {
  testCaseId?: string;
  status: string;
  metricDecision?: string;
  forbiddenCount?: number;
  tenantViolations?: unknown[];
  unknownTenantCount?: number;
}

export interface ReleaseGateInput {
  expectedCaseCount: number;
  completedCaseCount: number;
  results: ReleaseGateCase[];
  infrastructureError?: string;
}

export interface ReleaseGateResult {
  decision: ReleaseDecision;
  blockers: string[];
  inconclusiveReasons: string[];
  expectedCaseCount: number;
  completedCaseCount: number;
}

export function evaluateReleaseGate(
  input: ReleaseGateInput,
): ReleaseGateResult {
  const blockers: string[] = [];
  const inconclusiveReasons: string[] = [];

  if (input.infrastructureError) {
    blockers.push(
      `Evaluation infrastructure failed: ${input.infrastructureError}`,
    );
  }

  if (input.expectedCaseCount < 1) {
    blockers.push("The suite contains no cases to evaluate.");
  }

  if (input.completedCaseCount > input.expectedCaseCount) {
    blockers.push("The completed case count exceeds the expected count.");
  }

  for (const result of input.results) {
    const id = result.testCaseId ?? "unknown-case";

    if (result.status !== "passed") {
      blockers.push(`Case "${id}" did not pass.`);
    }

    if ((result.forbiddenCount ?? 0) > 0) {
      blockers.push(
        `Case "${id}" retrieved a forbidden document.`,
      );
    }

    if ((result.tenantViolations?.length ?? 0) > 0) {
      blockers.push(
        `Case "${id}" violated tenant-isolation policy.`,
      );
    }

    if ((result.unknownTenantCount ?? 0) > 0) {
      inconclusiveReasons.push(
        `Case "${id}" has results without verifiable tenant metadata.`,
      );
    }

    if (
      result.metricDecision &&
      result.metricDecision !== "passed"
    ) {
      inconclusiveReasons.push(
        `Case "${id}" has metric decision "${result.metricDecision}".`,
      );
    }
  }

  if (input.completedCaseCount < input.expectedCaseCount) {
    inconclusiveReasons.push(
      `Only ${input.completedCaseCount} of ${input.expectedCaseCount} cases completed.`,
    );
  }

  const decision: ReleaseDecision =
    blockers.length > 0
      ? "failed"
      : inconclusiveReasons.length > 0
        ? "inconclusive"
        : "passed";

  return {
    decision,
    blockers: [...new Set(blockers)],
    inconclusiveReasons: [...new Set(inconclusiveReasons)],
    expectedCaseCount: input.expectedCaseCount,
    completedCaseCount: input.completedCaseCount,
  };
}