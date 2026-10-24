import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE_NAME = "siftguard_session";
export const SESSION_DURATION_SECONDS = 8 * 60 * 60;

interface SessionPayload {
  role: "admin";
  expiresAt: number;
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();

  return (
    left.length === right.length &&
    timingSafeEqual(leftHash, rightHash)
  );
}

function getCookie(
  request: Request,
  name: string,
): string | null {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");

    if (index < 0) {
      continue;
    }

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key === name) {
      return value;
    }
  }

  return null;
}

export function createSessionToken(
  secret: string,
  now = Date.now(),
): string {
  if (secret.length < 32) {
    throw new Error(
      "SIFTGUARD_SESSION_SECRET must contain at least 32 characters.",
    );
  }

  const payload: SessionPayload = {
    role: "admin",
    expiresAt:
      now + SESSION_DURATION_SECONDS * 1000,
  };

  const encodedPayload = Buffer
    .from(JSON.stringify(payload))
    .toString("base64url");

  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  now = Date.now(),
): boolean {
  if (!token || secret.length < 32) {
    return false;
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return false;
  }

  const [encodedPayload, suppliedSignature] = parts;

  if (!encodedPayload || !suppliedSignature) {
    return false;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  if (!safeEqual(suppliedSignature, expectedSignature)) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as SessionPayload;

    return (
      payload.role === "admin" &&
      Number.isFinite(payload.expiresAt) &&
      payload.expiresAt > now
    );
  } catch {
    return false;
  }
}

export function validateAdminPassword(password: string): boolean {
  const expected = process.env.SIFTGUARD_ADMIN_PASSWORD;

  return Boolean(expected && safeEqual(password, expected));
}

export function isSessionAuthenticated(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  const secret = process.env.SIFTGUARD_SESSION_SECRET;
  const session = getCookie(request, SESSION_COOKIE_NAME);

  return Boolean(
    secret &&
      session &&
      verifySessionToken(session, secret),
  );
}

export function isAuthorizedRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  // Retain CLI access without exposing the token to browser JavaScript.
  const expectedToken = process.env.SIFTGUARD_ADMIN_TOKEN;
  const suppliedToken = request.headers.get(
    "x-siftguard-admin-token",
  );

  if (
    expectedToken &&
    suppliedToken &&
    safeEqual(expectedToken, suppliedToken)
  ) {
    return true;
  }

  return isSessionAuthenticated(request);
}