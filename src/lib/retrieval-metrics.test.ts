import { describe, expect, it } from "vitest";

import {
  evaluateRetrieval,
  meanMetric,
  type RetrievalMetricsInput,
} from "./retrieval-metrics";

const baseInput: RetrievalMetricsInput = {
  retrieved: [
    { documentId: "doc-a", score: 0.95, tenantId: "tenant-a" },
    { documentId: "doc-x", score: 0.85, tenantId: "tenant-a" },
    { documentId: "doc-b", score: 0.75, tenantId: "tenant-a" },
  ],
  requiredDocumentIds: ["doc-a", "doc-b", "doc-c"],
  topK: 3,
};

describe("evaluateRetrieval", () => {
  it("calculates Recall@K and Precision@K", () => {
    const result = evaluateRetrieval(baseInput);

    expect(result.recallAtK).toBeCloseTo(2 / 3);
    expect(result.precisionAtK).toBeCloseTo(2 / 3);
    expect(result.decision).toBe("passed");
  });

  it("uses K as the precision denominator when fewer results are returned", () => {
    const result = evaluateRetrieval({
      ...baseInput,
      retrieved: [{ documentId: "doc-a" }],
      topK: 5,
    });

    expect(result.precisionAtK).toBeCloseTo(1 / 5);
  });

  it("calculates reciprocal rank using the first relevant result", () => {
    const result = evaluateRetrieval({
      ...baseInput,
      retrieved: [
        { documentId: "doc-x" },
        { documentId: "doc-b" },
        { documentId: "doc-a" },
      ],
    });

    expect(result.reciprocalRank).toBe(0.5);
  });

  it("calculates nDCG when graded relevance is available", () => {
    const result = evaluateRetrieval({
      retrieved: [
        { documentId: "doc-low" },
        { documentId: "doc-high" },
      ],
      requiredDocumentIds: [],
      gradedRelevance: {
        "doc-low": 1,
        "doc-high": 3,
      },
      topK: 2,
    });

    const dcg = 1 + 7 / Math.log2(3);
    const idealDcg = 7 + 1 / Math.log2(3);

    expect(result.ndcgAtK).toBeCloseTo(dcg / idealDcg);
  });

  it("does not invent metrics when relevance judgments are missing", () => {
    const result = evaluateRetrieval({
      retrieved: [{ documentId: "doc-a" }],
      requiredDocumentIds: [],
      topK: 5,
    });

    expect(result.recallAtK).toBeNull();
    expect(result.precisionAtK).toBeNull();
    expect(result.reciprocalRank).toBeNull();
    expect(result.ndcgAtK).toBeNull();
    expect(result.decision).toBe("inconclusive");
  });

  it("deduplicates document IDs before calculating metrics", () => {
    const result = evaluateRetrieval({
      retrieved: [
        { documentId: "doc-a" },
        { documentId: "doc-a" },
        { documentId: "doc-b" },
      ],
      requiredDocumentIds: ["doc-a", "doc-b"],
      topK: 3,
    });

    expect(result.retrievedCount).toBe(2);
    expect(result.precisionAtK).toBeCloseTo(2 / 3);
    expect(result.recallAtK).toBe(1);
  });

  it("fails when a forbidden document is retrieved", () => {
    const result = evaluateRetrieval({
      retrieved: [
        { documentId: "doc-a", score: 0.9 },
        { documentId: "private-doc", score: 0.8 },
      ],
      requiredDocumentIds: ["doc-a"],
      forbiddenDocumentIds: ["private-doc"],
      topK: 2,
    });

    expect(result.forbiddenViolations).toHaveLength(1);
    expect(result.forbiddenViolations[0].rank).toBe(2);
    expect(result.decision).toBe("failed");
  });

  it("fails when a result belongs to another tenant", () => {
    const result = evaluateRetrieval({
      retrieved: [
        { documentId: "doc-a", tenantId: "tenant-a" },
        { documentId: "canary", tenantId: "tenant-b" },
      ],
      requiredDocumentIds: ["doc-a"],
      expectedTenantId: "tenant-a",
      topK: 2,
    });

    expect(result.tenantViolations).toHaveLength(1);
    expect(result.tenantViolations[0].documentId).toBe("canary");
    expect(result.decision).toBe("failed");
  });

  it("returns inconclusive when tenant metadata is missing", () => {
    const result = evaluateRetrieval({
      retrieved: [{ documentId: "doc-a" }],
      requiredDocumentIds: ["doc-a"],
      expectedTenantId: "tenant-a",
      topK: 1,
    });

    expect(result.unknownTenantCount).toBe(1);
    expect(result.decision).toBe("inconclusive");
  });

  it("fails when a configured metric threshold is not met", () => {
    const result = evaluateRetrieval({
      ...baseInput,
      thresholds: {
        minRecallAtK: 0.9,
      },
    });

    expect(result.decision).toBe("failed");
    expect(
      result.reasons.some((reason) => reason.includes("Recall@K")),
    ).toBe(true);
  });

  it("rejects invalid K and relevance grades", () => {
    expect(() =>
      evaluateRetrieval({
        ...baseInput,
        topK: 0,
      }),
    ).toThrow(/topK/);

    expect(() =>
      evaluateRetrieval({
        ...baseInput,
        gradedRelevance: {
          "doc-a": 4,
        },
      }),
    ).toThrow(/grade/);
  });

  it("rejects a document that is both required and forbidden", () => {
    expect(() =>
      evaluateRetrieval({
        ...baseInput,
        forbiddenDocumentIds: ["doc-a"],
      }),
    ).toThrow(/both required and forbidden/);
  });
});

describe("meanMetric", () => {
  it("averages available values and ignores unavailable metrics", () => {
    expect(meanMetric([1, 0.5, null])).toBe(0.75);
    expect(meanMetric([null, undefined])).toBeNull();
  });
});