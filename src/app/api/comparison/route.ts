import { NextResponse } from "next/server";
import { Query } from "node-appwrite";

import { appConfig } from "@/lib/config";
import { tablesDB } from "@/lib/appwrite";
import { listAllTableRows, type AppwriteRow } from "@/lib/appwrite-pagination";
import { isAuthorizedRequest } from "@/lib/auth";
import {
  compareEvaluationRuns,
  type ComparableCase,
  type ComparableRun,
  type ComparableMetrics,
} from "@/lib/experiment-comparison";

function rowObject(value: unknown): AppwriteRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Appwrite row.");
  }

  return value as AppwriteRow;
}

function relationId(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    return relationId(value[0]);
  }

  if (
    value !== null &&
    typeof value === "object" &&
    "$id" in value &&
    typeof (value as { $id?: unknown }).$id === "string"
  ) {
    return (value as { $id: string }).$id;
  }

  return "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);

    return parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function loadRun(runId: string): Promise<{
  row: AppwriteRow;
  comparison: ComparableRun;
}> {
  const runRow = rowObject(
    await tablesDB.getRow({
      databaseId: appConfig.databaseId,
      tableId: appConfig.tables.runs,
      rowId: runId,
    }),
  );

  const rows = await listAllTableRows(
    appConfig.tables.results,
    [Query.equal("run", runId)],
  );

  const cases: ComparableCase[] = rows.map((row) => {
    const trace = parseJsonRecord(row.trace_json);

    const snapshot =
      trace.experimentSnapshot &&
      typeof trace.experimentSnapshot === "object"
        ? (trace.experimentSnapshot as ComparableCase["snapshot"])
        : null;

    const metrics: ComparableMetrics = {
      recallAtK:
        numberOrNull(trace.recallAtK) ??
        numberOrNull(row.recall_at_k),
      precisionAtK: numberOrNull(trace.precisionAtK),
      reciprocalRank:
        numberOrNull(trace.reciprocalRank) ??
        numberOrNull(row.reciprocal_rank),
      ndcgAtK: numberOrNull(trace.ndcgAtK),
      latencyMs: numberOrNull(row.latency_ms),
    };

    const tenantViolations = Array.isArray(trace.tenantViolations)
      ? trace.tenantViolations
      : [];

    const testCaseId = relationId(row.test_case);

    return {
      testCaseId: testCaseId || String(row.$id ?? "unknown-case"),
      query:
        typeof trace.query === "string"
          ? trace.query
          : undefined,
      status: String(row.status ?? "unknown"),
      metrics,
      forbiddenCount: Math.max(
        0,
        typeof row.forbidden_count === "number"
          ? row.forbidden_count
          : 0,
      ),
      tenantViolationCount: tenantViolations.length,
      snapshot,
    };
  });

  return {
    row: runRow,
    comparison: {
      runId,
      suiteId: relationId(runRow.suite),
      status: String(runRow.status ?? "unknown"),
      cases,
    },
  };
}

export async function POST(request: Request) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("baselineRunId" in body) ||
    !("candidateRunId" in body) ||
    typeof body.baselineRunId !== "string" ||
    typeof body.candidateRunId !== "string" ||
    !body.baselineRunId.trim() ||
    !body.candidateRunId.trim()
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "baselineRunId and candidateRunId are required.",
      },
      { status: 400 },
    );
  }

  const baselineRunId = body.baselineRunId.trim();
  const candidateRunId = body.candidateRunId.trim();

  if (baselineRunId === candidateRunId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Choose two different evaluation runs.",
      },
      { status: 400 },
    );
  }

  try {
    const [baseline, candidate] = await Promise.all([
      loadRun(baselineRunId),
      loadRun(candidateRunId),
    ]);

    if (
      baseline.comparison.suiteId !== candidate.comparison.suiteId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Baseline and candidate must belong to the same suite.",
        },
        { status: 400 },
      );
    }

    const comparison = compareEvaluationRuns(
      baseline.comparison,
      candidate.comparison,
    );

    return NextResponse.json(
      {
        ok: true,
        baseline: {
          runId: baseline.comparison.runId,
          status: baseline.comparison.status,
          createdAt: baseline.row.$createdAt ?? null,
        },
        candidate: {
          runId: candidate.comparison.runId,
          status: candidate.comparison.status,
          createdAt: candidate.row.$createdAt ?? null,
        },
        comparison,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("SiftGuard comparison failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          process.env.NODE_ENV === "production"
            ? "Comparison failed. Check server logs for details."
            : error instanceof Error
              ? error.message
              : "Comparison failed.",
      },
      { status: 500 },
    );
  }
}