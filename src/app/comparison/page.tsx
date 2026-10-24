"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface RunOption {
  id: string;
  status: string;
  suiteId: string;
  createdAt: string;
  totalCases: number;
}

interface DashboardResponse {
  ok: boolean;
  recentRuns?: RunOption[];
  error?: string;
}

interface CaseComparison {
  testCaseId: string;
  query?: string;
  status: string;
  reasons: string[];
  metrics: Record<
    string,
    {
      baseline: number | null;
      candidate: number | null;
      delta: number | null;
    }
  >;
}

interface ComparisonResponse {
  ok: boolean;
  error?: string;
  comparison?: {
    status: string;
    regressionCount: number;
    improvedCount: number;
    inconclusiveCount: number;
    drift: {
      available: boolean;
      configurationChanged: boolean | null;
      contractsChanged: boolean | null;
      corpusMetadataChanged: boolean | null;
    };
    cases: CaseComparison[];
  };
}

function formatDelta(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "—";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(3)}`;
}

export default function ComparisonPage() {
  const [runs, setRuns] = useState<RunOption[]>([]);
  const [baselineRunId, setBaselineRunId] = useState("");
  const [candidateRunId, setCandidateRunId] = useState("");
  const [comparison, setComparison] =
    useState<ComparisonResponse | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadRuns() {
      try {
        const response = await fetch("/api/dashboard", {
          cache: "no-store",
        });

        const body = (await response.json()) as DashboardResponse;

        if (!response.ok || !body.ok) {
          throw new Error(
            body.error ?? "Could not load evaluation history.",
          );
        }

        const available = body.recentRuns ?? [];

        if (cancelled) {
          return;
        }

        setRuns(available);

        const baseline =
          available.find((run) => run.status === "passed") ??
          available[0];

        const candidate = available.find(
          (run) =>
            run.id !== baseline?.id &&
            (!baseline || run.suiteId === baseline.suiteId),
        );

        setBaselineRunId(baseline?.id ?? "");
        setCandidateRunId(candidate?.id ?? "");
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load evaluation history.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingRuns(false);
        }
      }
    }

    void loadRuns();

    return () => {
      cancelled = true;
    };
  }, []);

  const baseline = runs.find((run) => run.id === baselineRunId);

  const candidates = runs.filter(
    (run) =>
      run.id !== baselineRunId &&
      (!baseline || run.suiteId === baseline.suiteId),
  );

  async function runComparison() {
    setError("");
    setComparison(null);
    setRunning(true);

    try {
      const response = await fetch("/api/comparison", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          baselineRunId,
          candidateRunId,
        }),
      });

      const body = (await response.json()) as ComparisonResponse;

      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "Comparison failed.");
      }

      setComparison(body);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Comparison failed.",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#080c14] px-4 py-8 text-slate-100 sm:px-7">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-teal-300">
              Experiment analysis
            </p>

            <h1 className="mt-3 text-3xl font-semibold">
              Baseline comparison
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              Compare persisted evaluation runs, inspect metric deltas,
              and identify changes in configuration, contract definitions,
              or corpus metadata.
            </p>
          </div>

          <Link
            href="/regression"
            className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 hover:border-teal-300/40 hover:text-teal-200"
          >
            Open Regression Lab
          </Link>
        </div>

        <section className="mt-8 grid gap-4 rounded-2xl border border-white/[0.08] bg-[#0e1420] p-5 md:grid-cols-2">
          <label className="text-sm text-slate-300">
            Baseline run

            <select
              value={baselineRunId}
              onChange={(event) => {
                const nextBaseline = event.target.value;
                const nextBaselineRun = runs.find(
                  (run) => run.id === nextBaseline,
                );

                const nextCandidate = runs.find(
                  (run) =>
                    run.id !== nextBaseline &&
                    (!nextBaselineRun ||
                      run.suiteId === nextBaselineRun.suiteId),
                );

                setBaselineRunId(nextBaseline);
                setCandidateRunId(nextCandidate?.id ?? "");
                setComparison(null);
              }}
              disabled={loadingRuns}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-[#080c14] px-3 py-3 text-sm"
            >
              <option value="">Select baseline</option>

              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.id} · {run.status} · {run.createdAt}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-300">
            Candidate run

            <select
              value={candidateRunId}
              onChange={(event) => {
                setCandidateRunId(event.target.value);
                setComparison(null);
              }}
              disabled={loadingRuns || !baselineRunId}
              className="mt-2 block w-full rounded-xl border border-white/10 bg-[#080c14] px-3 py-3 text-sm"
            >
              <option value="">Select candidate</option>

              {candidates.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.id} · {run.status} · {run.createdAt}
                </option>
              ))}
            </select>
          </label>

          <div className="md:col-span-2">
            <button
              type="button"
              onClick={() => void runComparison()}
              disabled={
                running ||
                !baselineRunId ||
                !candidateRunId ||
                baselineRunId === candidateRunId
              }
              className="rounded-xl bg-teal-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Comparing runs…" : "Compare runs"}
            </button>
          </div>
        </section>

        {error && (
          <div className="mt-5 rounded-xl border border-rose-300/20 bg-rose-300/5 p-4 text-sm text-rose-200">
            {error}
          </div>
        )}

        {comparison?.comparison && (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Decision", comparison.comparison.status],
                [
                  "Regressions",
                  String(comparison.comparison.regressionCount),
                ],
                [
                  "Improvements",
                  String(comparison.comparison.improvedCount),
                ],
                [
                  "Inconclusive",
                  String(comparison.comparison.inconclusiveCount),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-2xl border border-white/[0.08] bg-[#0e1420] p-5"
                >
                  <p className="text-sm text-slate-400">{label}</p>
                  <p className="mt-3 break-words text-xl font-semibold text-white">
                    {value}
                  </p>
                </div>
              ))}
            </section>

            <section className="mt-6 rounded-2xl border border-white/[0.08] bg-[#0e1420] p-5">
              <h2 className="text-lg font-semibold">
                Configuration and data drift
              </h2>

              <p className="mt-2 text-sm text-slate-400">
                A changed fingerprint establishes metadata drift; it does
                not, by itself, prove that the change caused a regression.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  [
                    "Configuration",
                    comparison.comparison.drift.configurationChanged,
                  ],
                  [
                    "Contracts",
                    comparison.comparison.drift.contractsChanged,
                  ],
                  [
                    "Corpus metadata",
                    comparison.comparison.drift.corpusMetadataChanged,
                  ],
                ].map(([label, changed]) => (
                  <div
                    key={String(label)}
                    className="rounded-xl border border-white/10 p-4"
                  >
                    <p className="text-sm text-slate-400">{label}</p>

                    <p className="mt-2 font-medium">
                      {changed === null
                        ? "Unavailable"
                        : changed
                          ? "Changed"
                          : "Unchanged"}
                    </p>
                  </div>
                ))}
              </div>

              {!comparison.comparison.drift.available && (
                <p className="mt-3 text-xs text-amber-200">
                  At least one run lacks snapshot metadata. Metric comparison
                  remains available, but configuration drift cannot be
                  established reliably for these runs.
                </p>
              )}
            </section>

            <section className="mt-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0e1420]">
              <div className="border-b border-white/[0.08] p-5">
                <h2 className="text-lg font-semibold">
                  Per-case comparison
                </h2>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-white/[0.025] text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Case</th>
                      <th className="px-4 py-3">Classification</th>
                      <th className="px-4 py-3">Recall delta</th>
                      <th className="px-4 py-3">Precision delta</th>
                      <th className="px-4 py-3">MRR delta</th>
                      <th className="px-4 py-3">Latency delta</th>
                      <th className="px-4 py-3">Evidence</th>
                    </tr>
                  </thead>

                  <tbody>
                    {comparison.comparison.cases.map((item) => (
                      <tr
                        key={item.testCaseId}
                        className="border-t border-white/[0.06] align-top"
                      >
                        <td className="max-w-[240px] px-4 py-4">
                          <p className="font-medium text-slate-200">
                            {item.testCaseId}
                          </p>

                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            {item.query ?? "Query unavailable"}
                          </p>
                        </td>

                        <td className="px-4 py-4">
                          <span
                            className={
                              item.status === "regressed"
                                ? "text-rose-300"
                                : item.status === "improved"
                                  ? "text-emerald-300"
                                  : "text-slate-300"
                            }
                          >
                            {item.status}
                          </span>
                        </td>

                        <td className="px-4 py-4 tabular-nums">
                          {formatDelta(item.metrics.recallAtK?.delta)}
                        </td>

                        <td className="px-4 py-4 tabular-nums">
                          {formatDelta(item.metrics.precisionAtK?.delta)}
                        </td>

                        <td className="px-4 py-4 tabular-nums">
                          {formatDelta(item.metrics.reciprocalRank?.delta)}
                        </td>

                        <td className="px-4 py-4 tabular-nums">
                          {formatDelta(item.metrics.latencyMs?.delta)} ms
                        </td>

                        <td className="max-w-[300px] px-4 py-4 text-xs leading-5 text-slate-400">
                          {item.reasons.length
                            ? item.reasons.join(" ")
                            : "No threshold-based regression detected."}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}