import { NextResponse } from "next/server";

import {
  createCustomCase,
  getContractCatalog,
} from "@/lib/custom-contracts";
import { isAuthorizedRequest } from "@/lib/auth";

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function errorMessage(error: unknown): string {
  if (process.env.NODE_ENV === "production") {
    return "The contracts request failed. Check server logs for details.";
  }

  return error instanceof Error
    ? error.message
    : "The contracts request failed.";
}

export async function GET(request: Request) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const catalog = await getContractCatalog();

    return NextResponse.json(
      { ok: true, ...catalog },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("SiftGuard contracts catalog failed:", error);

    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;

  try {
    const parsed: unknown = await request.json();

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return NextResponse.json(
        { ok: false, error: "Request body must be a JSON object." },
        { status: 400 },
      );
    }

    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (
    typeof body.suiteId !== "string" ||
    typeof body.query !== "string" ||
    typeof body.tenantId !== "string" ||
    typeof body.topK !== "number"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "suiteId, query, tenantId and numeric topK are required.",
      },
      { status: 400 },
    );
  }

  try {
    const created = await createCustomCase({
      suiteId: body.suiteId,
      query: body.query,
      category:
        typeof body.category === "string"
          ? body.category
          : "general",
      tenantId: body.tenantId,
      topK: body.topK,
      requiredDocumentIds: stringArray(body.requiredDocumentIds),
      forbiddenDocumentIds: stringArray(body.forbiddenDocumentIds),
    });

    return NextResponse.json(
      { ok: true, testCase: created },
      { status: 201 },
    );
  } catch (error) {
    console.error("SiftGuard custom contract creation failed:", error);

    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 400 },
    );
  }
}