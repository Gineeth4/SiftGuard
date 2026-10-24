import { NextResponse } from "next/server";

import { appConfig } from "@/lib/config";
import { isAuthorizedRequest } from "@/lib/auth";
import { listAllTableRows } from "@/lib/appwrite-pagination";

type Row = Record<string, unknown>;

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

function numeric(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return [];
  }

  try {
    const result: unknown = JSON.parse(value);
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }

  try {
    const result: unknown = JSON.parse(value);

    return result &&
      typeof result === "object" &&
      !Array.isArray(result)
      ? result as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function timestamp(row: Row): number {
  const value = row.$createdAt ?? row.created_at;
  const parsed = typeof value === "string"
    ? new Date(value).getTime()
    : 0;

  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const [
      suiteRows,
      caseRows,
      documentRows,
      runRows,
      resultRows,
    ] = await Promise.all([
      listAllTableRows(appConfig.tables.suites),
      listAllTableRows(appConfig.tables.cases),
      listAllTableRows(appConfig.tables.documents),
      listAllTableRows(appConfig.tables.runs),
      listAllTableRows(appConfig.tables.results),
    ]);

    const sortedRunRows = [...runRows].sort(
      (a, b) => timestamp(b) - timestamp(a),
    );

    const sortedResultRows = [...resultRows].sort(
      (a, b) => timestamp(b) - timestamp(a),
    );

    const caseMap = new Map(
      caseRows.map((row) => [
        String(row.$id ?? ""),
        row,
      ]),
    );

    const recentRuns = sortedRunRows.slice(0, 30).map((row) => ({
      id: String(row.$id ?? ""),
      suiteId: relationId(row.suite),
      status: String(row.status ?? "unknown"),
      backend: String(row.backend ?? "qdrant"),
      trigger: String(row.trigger ?? "manual"),
      totalCases: numeric(row.total_cases),
      passedCases: numeric(row.passed_cases),
      failedCases: numeric(row.failed_cases),
      passRate: numeric(row.pass_rate),
      durationMs: numeric(row.duration_ms),
      createdAt: String(row.$createdAt ?? row.started_at ?? ""),
      finishedAt: String(row.finished_at ?? ""),
      summary: String(row.summary ?? ""),
    }));

    const latestRun = recentRuns[0] ?? null;

    const results = sortedResultRows.map((row) => {
      const trace = jsonObject(row.trace_json);
      const testCaseId = relationId(row.test_case);
      const testCase = caseMap.get(testCaseId);

      const traceRetrieved = Array.isArray(trace.retrieved)
        ? trace.retrieved
        : [];

      const retrieved = traceRetrieved.map((item) => {
        const value = item as Record<string, unknown>;

        return {
          documentId: String(value.documentId ?? ""),
          title: String(value.title ?? "Untitled document"),
          score: numeric(value.score),
        };
      });

      const documentIds = jsonArray(
        row.actual_document_ids_json,
      ).filter((value): value is string => typeof value === "string");

      return {
        id: String(row.$id ?? ""),
        runId: relationId(row.run),
        testCaseId,
        query: String(
          trace.query ??
            testCase?.query_text ??
            "",
        ),
        status: String(row.status ?? "unknown"),
        recallAtK: numeric(
          trace.recallAtK,
          numeric(row.recall_at_k),
        ),
        precisionAtK:
          typeof trace.precisionAtK === "number"
            ? trace.precisionAtK
            : null,
        reciprocalRank: numeric(
          trace.reciprocalRank,
          numeric(row.reciprocal_rank),
        ),
        ndcgAtK:
          typeof trace.ndcgAtK === "number"
            ? trace.ndcgAtK
            : null,
        latencyMs: numeric(row.latency_ms),
        expectedCount: numeric(row.expected_count),
        retrievedCount: numeric(
          row.retrieved_count,
          retrieved.length,
        ),
        forbiddenCount: numeric(row.forbidden_count),
        failureCode: String(row.failure_code ?? ""),
        failureSummary: String(row.failure_summary ?? ""),
        actualDocumentIds: documentIds,
        retrieved,
        createdAt: String(row.$createdAt ?? ""),
      };
    });

    const latestRunResults = latestRun
      ? results.filter((result) => result.runId === latestRun.id)
      : [];

    const recentResults = results.slice(0, 30);

    const averageLatencyMs =
      recentResults.length > 0
        ? recentResults.reduce(
            (sum, result) => sum + result.latencyMs,
            0,
          ) / recentResults.length
        : 0;

    return NextResponse.json(
      {
        ok: true,
        stats: {
          totalSuites: suiteRows.length,
          totalCases: caseRows.length,
          totalDocuments: documentRows.filter(
            (row) => String(row.status ?? "active") === "active",
          ).length,
          totalRuns: runRows.length,
          latestPassRate: latestRun?.passRate ?? 0,
          latestRunStatus: latestRun?.status ?? "not_run",
          latestTotalCases: latestRun?.totalCases ?? 0,
          latestPassedCases: latestRun?.passedCases ?? 0,
          latestFailedCases: latestRun?.failedCases ?? 0,
          latestForbiddenCount: latestRunResults.reduce(
            (sum, result) => sum + result.forbiddenCount,
            0,
          ),
          averageLatencyMs,
        },
        latestRun,
        recentRuns,
        latestRunResults,
        recentResults,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error("SiftGuard dashboard request failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          process.env.NODE_ENV === "production"
            ? "Dashboard data could not be loaded."
            : error instanceof Error
              ? error.message
              : "Dashboard data could not be loaded.",
      },
      { status: 500 },
    );
  }
}