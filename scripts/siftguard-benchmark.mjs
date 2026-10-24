#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage() {
  console.log(`
SiftGuard benchmark runner

Usage:
  node scripts/siftguard-benchmark.mjs --suite SUITE_ID [options]

Options:
  --suite ID       Required suite ID
  --base-url URL   Defaults to SIFTGUARD_BASE_URL or localhost:3000
  --report PATH    Optional JSON report path
  --help           Show this help

Environment:
  SIFTGUARD_BASE_URL
  SIFTGUARD_ADMIN_TOKEN
`);
}

if (process.argv.includes("--help")) {
  usage();
  process.exit(0);
}

const suiteId = argument("--suite");
const baseUrl =
  argument("--base-url") ||
  process.env.SIFTGUARD_BASE_URL ||
  "http://localhost:3000";
const reportPath = argument("--report");

if (!suiteId) {
  console.error("Missing required --suite ID.");
  usage();
  process.exit(2);
}

let target;

try {
  target = new URL(baseUrl);
  target.username = "";
  target.password = "";
} catch {
  console.error("Invalid base URL.");
  process.exit(2);
}

const startedAt = new Date().toISOString();

try {
  const headers = {
    "Content-Type": "application/json",
  };

  if (process.env.SIFTGUARD_ADMIN_TOKEN) {
    headers["x-siftguard-admin-token"] =
      process.env.SIFTGUARD_ADMIN_TOKEN;
  }

  const response = await fetch(
    new URL("/api/contracts/evaluate", target),
    {
      method: "POST",
      headers,
      body: JSON.stringify({ suiteId }),
      signal: AbortSignal.timeout(180_000),
    },
  );

  const payload = await response.json();

  const evaluation = payload?.evaluation;
  const completedAt = new Date().toISOString();

  const report = {
    schemaVersion: 1,
    benchmark: "siftguard-custom-contract-suite",
    startedAt,
    completedAt,
    target: `${target.origin}${target.pathname}`,
    suiteId,
    httpStatus: response.status,
    ok:
      response.ok &&
      payload?.ok === true &&
      evaluation?.status === "passed",
    evaluation: evaluation ?? null,
    error: payload?.error ?? null,
  };

  if (reportPath) {
    await writeFile(
      reportPath,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );

    console.log(`Report written to ${reportPath}`);
  }

  console.log(JSON.stringify({
    ok: report.ok,
    suiteId,
    status: evaluation?.status ?? "unavailable",
    totalCases: evaluation?.totalCases ?? 0,
    passedCases: evaluation?.passedCases ?? 0,
    failedCases: evaluation?.failedCases ?? 0,
    durationMs: evaluation?.durationMs ?? null,
  }, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    "Benchmark execution failed:",
    error instanceof Error ? error.message : "Unknown error",
  );

  process.exitCode = 1;
}