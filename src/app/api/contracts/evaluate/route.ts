import { NextResponse } from "next/server";

import { evaluateCustomSuite } from "@/lib/custom-contracts";
import { isAuthorizedRequest } from "@/lib/auth";

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
    !("suiteId" in body) ||
    typeof body.suiteId !== "string" ||
    !body.suiteId.trim()
  ) {
    return NextResponse.json(
      { ok: false, error: "A valid suiteId is required." },
      { status: 400 },
    );
  }

  try {
    const evaluation = await evaluateCustomSuite(body.suiteId.trim());

    return NextResponse.json(
      { ok: true, evaluation },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "SiftGuard custom suite evaluation failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          process.env.NODE_ENV === "production"
            ? "Custom suite evaluation failed. Check server logs for details."
            : error instanceof Error
              ? error.message
              : "Custom suite evaluation failed.",
      },
      { status: 500 },
    );
  }
}