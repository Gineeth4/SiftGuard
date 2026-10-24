
/* global process, console, fetch */

const BASE_URL = (
  getArgument("--base-url") ??
  process.env.SIFTGUARD_BASE_URL ??
  "http://localhost:3000"
).replace(/\/+$/, "");

const SCENARIO =
  getArgument("--scenario") ?? "exclude_expected_document";

const ADMIN_TOKEN = process.env.SIFTGUARD_ADMIN_TOKEN;

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...options.headers,
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (ADMIN_TOKEN) {
    headers["x-siftguard-admin-token"] = ADMIN_TOKEN;
  }

  let response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new Error(
      `Could not reach ${BASE_URL}${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `${path} returned non-JSON content (HTTP ${response.status}).`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `${path} returned HTTP ${response.status}: ${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

function findFirst(object, predicate, visited = new Set()) {
  if (!object || typeof object !== "object" || visited.has(object)) {
    return undefined;
  }

  visited.add(object);

  if (predicate(object)) {
    return object;
  }

  for (const value of Object.values(object)) {
    const result = findFirst(value, predicate, visited);

    if (result !== undefined) {
      return result;
    }
  }

  return undefined;
}

function readRunId(payload) {
  const result = findFirst(
    payload,
    (value) =>
      typeof value.runId === "string" && value.runId.length > 0,
  );

  return result?.runId;
}

function readStatus(payload) {
  const result = findFirst(
    payload,
    (value) =>
      typeof value.status === "string" &&
      ["passed", "failed", "error"].includes(value.status),
  );

  return result?.status;
}

function readRegressionCount(payload) {
  let total = 0;
  const visited = new Set();

  function visit(value) {
    if (!value || typeof value !== "object" || visited.has(value)) {
      return;
    }

    visited.add(value);

    if (
      Number.isInteger(value.regressionCount) &&
      value.regressionCount > total
    ) {
      total = value.regressionCount;
    }

    for (const child of Object.values(value)) {
      visit(child);
    }
  }

  visit(payload);
  return total;
}

function hasExplicitRegression(payload) {
  return Boolean(
    findFirst(payload, (value) => value.regress === true),
  );
}

async function main() {
  console.log("\nSiftGuard Regression Smoke Test");
  console.log(`Target:   ${BASE_URL}`);
  console.log(`Scenario: ${SCENARIO}\n`);

  // 1. Confirm Appwrite, Qdrant and Ollama are reachable.
  const health = await requestJson("/api/health");

  assert(
    health.ok === true,
    "Health check failed. Inspect /api/health before continuing.",
  );

  console.log("[PASS] Health check");

  // 2. Create a known-good baseline.
  const baseline = await requestJson("/api/demo/run", {
    method: "POST",
  });

  const baselineRunId = readRunId(baseline);
  const baselineStatus = readStatus(baseline);

  assert(
    baselineRunId,
    "Baseline response did not contain a runId.",
  );

  assert(
    baselineStatus === "passed",
    `Baseline must pass; received status "${baselineStatus ?? "unknown"}".`,
  );

  console.log(`[PASS] Baseline evaluation: ${baselineRunId}`);

  // 3. Inject a known failure and compare it with the baseline.
  const candidate = await requestJson("/api/regression/run", {
    method: "POST",
    body: JSON.stringify({
      scenario: SCENARIO,
      baselineRunId,
    }),
  });

  const candidateRunId = readRunId(candidate);
  const candidateStatus = readStatus(candidate);
  const regressionCount = readRegressionCount(candidate);
  const explicitRegression = hasExplicitRegression(candidate);

  assert(
    candidateRunId,
    "Candidate response did not contain a runId.",
  );

  assert(
    candidateStatus === "failed",
    `Expected the fault-injected candidate to fail; received "${
      candidateStatus ?? "unknown"
    }".`,
  );

  assert(
    regressionCount > 0 || explicitRegression,
    "The candidate failed, but the response did not confirm that a regression was detected.",
  );

  console.log(`[PASS] Fault-injection scenario detected`);
  console.log(`       Candidate: ${candidateRunId}`);
  console.log(`       Status:    ${candidateStatus}`);
  console.log(
    `       Regressions reported: ${regressionCount || "explicit regression flag"}`,
  );

  console.log(
    "\nSMOKE TEST PASSED: SiftGuard detected the expected injected failure.\n",
  );
}

main().catch((error) => {
  console.error("\nSMOKE TEST FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
