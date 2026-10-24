
import { NextResponse } from "next/server";

import { runDemoEvaluation } from "@/lib/phase2-demo";
import { isAuthorizedRequest } from "@/lib/auth";

export async function POST(request: Request) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const result = await runDemoEvaluation();

    return NextResponse.json(
      {
        ok: true,
        message: "SiftGuard evaluation completed.",
        evaluation: result,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    const errorDetails =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause:
              error.cause instanceof Error
                ? {
                    name: error.cause.name,
                    message: error.cause.message,
                    stack: error.cause.stack,
                  }
                : error.cause,
          }
        : {
            name: typeof error,
            message: String(error),
          };

    console.error(
      "[api/demo/run] Evaluation failed:",
      errorDetails,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          process.env.NODE_ENV === "production"
            ? "Evaluation failed. Check server logs for details."
            : error instanceof Error
              ? error.message
              : "An unexpected evaluation error occurred.",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
