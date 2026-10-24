import { NextResponse } from "next/server";

import {
  runDemoEvaluation,
  type DemoScenario,
} from "@/lib/phase2-demo";
import { isAuthorizedRequest } from "@/lib/auth";

const allowedScenarios = [
  "exclude_expected_document",
  "wrong_tenant_filter",
] as const;

type RegressionScenario = (typeof allowedScenarios)[number];

function isRegressionScenario(
  value: unknown,
): value is RegressionScenario {
  return (
    typeof value === "string" &&
    allowedScenarios.some((scenario) => scenario === value)
  );
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
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return NextResponse.json(
      { ok: false, error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  const input = body as Record<string, unknown>;

  if (!isRegressionScenario(input.scenario)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Unsupported scenario. Use exclude_expected_document or wrong_tenant_filter.",
      },
      { status: 400 },
    );
  }

  if (
    typeof input.baselineRunId !== "string" ||
    !input.baselineRunId.trim()
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "baselineRunId is required. Run a successful baseline evaluation first.",
      },
      { status: 400 },
    );
  }

  try {
    const evaluation = await runDemoEvaluation({
      scenario: input.scenario as DemoScenario,
      baselineRunId: input.baselineRunId.trim(),
    });

    return NextResponse.json(
      {
        ok: true,
        message:
          "Regression scenario executed against real vector search results.",
        evaluation,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[api/regression/run] Failure:", error);
    console.error("SiftGuard regression run failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          process.env.NODE_ENV === "production"
            ? "Regression evaluation failed. Check server logs for details."
            : error instanceof Error
              ? error.message
              : "Regression evaluation failed.",
      },
      { status: 500 },
    );
  }
}