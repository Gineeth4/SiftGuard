import { describe, expect, it } from "vitest";

import {
  createExperimentSnapshot,
  type ExperimentSnapshotInput,
} from "./experiment-snapshots";
import { compareEvaluationRuns } from "./experiment-comparison";
import { evaluateReleaseGate } from "./release-gate";

const snapshotInput: ExperimentSnapshotInput = {
  runId: "run-a",
  suite: {
    id: "suite-1",
    name: "Test suite",
    status: "active",
    minimumRecallAtK: 1,
    topK: 3,
  },
  cases: [
    {
      id: "case-1",
      query: "Find a refund policy",
      category: "support",
      tenantId: "tenant-a",
      topK: 3,
      requiredRules: [
        { documentId: "doc-a", maxRank: 3 },
      ],
      forbiddenRules: [
        { documentId: "doc-b" },
      ],
    },
  ],
  corpusDocuments: [
    {
      id: "doc-a",
      title: "Refund policy",
      category: "support",
      tenantId: "tenant-a",
      status: "active",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
  embeddingModel: "nomic-embed-text",
  qdrantCollection: "siftguard_corpus",
  qdrantMetadata: {
    available: true,
    vectorDimensions: 768,
    distanceMetric: "Cosine",
    vectorName: "default",
  },
  appBuild: "test-commit",
};

describe("experiment snapshots", () => {
  it("produces stable fingerprints for equivalent inputs", () => {
    const first = createExperimentSnapshot(snapshotInput);
    const second = createExperimentSnapshot({
      ...snapshotInput,
      runId: "run-b",
    });

    expect(first.fingerprints.configurationFingerprint).toBe(
      second.fingerprints.configurationFingerprint,
    );

    expect(first.fingerprints.contractFingerprint).toBe(
      second.fingerprints.contractFingerprint,
    );

    expect(first.fingerprints.corpusFingerprint).toBe(
      second.fingerprints.corpusFingerprint,
    );
  });

  it("detects contract and corpus changes", () => {
    const baseline = createExperimentSnapshot(snapshotInput);

    const changedContract = createExperimentSnapshot({
      ...snapshotInput,
      cases: snapshotInput.cases.map((item) => ({
        ...item,
        topK: 5,
      })),
    });

    const changedCorpus = createExperimentSnapshot({
      ...snapshotInput,
      corpusDocuments: [
        ...snapshotInput.corpusDocuments,
        {
          id: "doc-c",
          title: "New document",
          category: "support",
          tenantId: "tenant-a",
          status: "active",
          updatedAt: null,
        },
      ],
    });

    expect(
      changedContract.fingerprints.contractFingerprint,
    ).not.toBe(baseline.fingerprints.contractFingerprint);

    expect(
      changedCorpus.fingerprints.corpusFingerprint,
    ).not.toBe(baseline.fingerprints.corpusFingerprint);
  });
});

describe("baseline comparison", () => {
  it("classifies a substantial recall drop as a regression", () => {
    const baseline = createExperimentSnapshot(snapshotInput);

    const comparison = compareEvaluationRuns(
      {
        runId: "baseline",
        suiteId: "suite-1",
        status: "passed",
        cases: [
          {
            testCaseId: "case-1",
            status: "passed",
            metrics: {
              recallAtK: 1,
              precisionAtK: 0.8,
              reciprocalRank: 1,
              ndcgAtK: 1,
              latencyMs: 20,
            },
            forbiddenCount: 0,
            tenantViolationCount: 0,
            snapshot: baseline,
          },
        ],
      },
      {
        runId: "candidate",
        suiteId: "suite-1",
        status: "failed",
        cases: [
          {
            testCaseId: "case-1",
            status: "failed",
            metrics: {
              recallAtK: 0.7,
              precisionAtK: 0.8,
              reciprocalRank: 1,
              ndcgAtK: 1,
              latencyMs: 20,
            },
            forbiddenCount: 0,
            tenantViolationCount: 0,
            snapshot: baseline,
          },
        ],
      },
    );

    expect(comparison.status).toBe("regressed");
    expect(comparison.regressionCount).toBe(1);
  });
});

describe("release gate", () => {
  it("blocks forbidden-document violations", () => {
    const result = evaluateReleaseGate({
      expectedCaseCount: 1,
      completedCaseCount: 1,
      results: [
        {
          testCaseId: "case-1",
          status: "passed",
          metricDecision: "passed",
          forbiddenCount: 1,
          tenantViolations: [],
          unknownTenantCount: 0,
        },
      ],
    });

    expect(result.decision).toBe("failed");
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("does not pass an incomplete run", () => {
    const result = evaluateReleaseGate({
      expectedCaseCount: 4,
      completedCaseCount: 3,
      results: [
        {
          status: "passed",
          metricDecision: "passed",
        },
      ],
    });

    expect(result.decision).toBe("inconclusive");
  });

  it("passes a complete clean run", () => {
    const result = evaluateReleaseGate({
      expectedCaseCount: 1,
      completedCaseCount: 1,
      results: [
        {
          testCaseId: "case-1",
          status: "passed",
          metricDecision: "passed",
          forbiddenCount: 0,
          tenantViolations: [],
          unknownTenantCount: 0,
        },
      ],
    });

    expect(result.decision).toBe("passed");
  });
});