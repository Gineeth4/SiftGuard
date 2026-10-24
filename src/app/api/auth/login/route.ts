import { NextResponse } from "next/server";

import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
  validateAdminPassword,
} from "@/lib/auth";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json({ ok: true });
  }

  const sessionSecret = process.env.SIFTGUARD_SESSION_SECRET;

  if (
    !sessionSecret ||
    sessionSecret.length < 32 ||
    !process.env.SIFTGUARD_ADMIN_PASSWORD
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Administrator login is not configured.",
      },
      { status: 503 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON request." },
      { status: 400 },
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("password" in body) ||
    typeof body.password !== "string" ||
    body.password.length > 2048
  ) {
    return NextResponse.json(
      { ok: false, error: "A valid password is required." },
      { status: 400 },
    );
  }

  if (!validateAdminPassword(body.password)) {
    return NextResponse.json(
      { ok: false, error: "Invalid credentials." },
      { status: 401 },
    );
  }

  const token = createSessionToken(sessionSecret);
  const response = NextResponse.json({ ok: true });

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });

  response.headers.set("Cache-Control", "no-store");

  return response;
}