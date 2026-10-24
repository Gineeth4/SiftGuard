import { NextResponse } from "next/server";

import { isSessionAuthenticated } from "@/lib/auth";

export async function GET(request: Request) {
  return NextResponse.json(
    {
      ok: true,
      authenticated: isSessionAuthenticated(request),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}