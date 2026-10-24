"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";

import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  GitCompareArrows,
  Layers3,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Zap,
} from "lucide-react";

type Scenario =
  | "exclude_expected_document"
  | "wrong_tenant_filter";

type EvaluationRun = {
  id: string;
  suiteId: string;
  status: string;
  backend: string;
  trigger: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  durationMs: number;
  createdAt: string;
  finishedAt: string;
  summary: string;
};

type DashboardData = {
  ok: boolean;
  stats: {
    totalRuns: number;
    totalCases: number;
  };
  latestRun: EvaluationRun | null;
  recentRuns: EvaluationRun[];
};

type RetrievedDocument = {
  documentId: string;
  title: string;
  score: number;
};

type CaseResult = {
  testCaseId: string;
  query: string;
  status: "passed" | "failed";
  recallAtK: number;
  reciprocalRank: number;
  forbiddenCount: number;
  latencyMs: number;
  retrieved: RetrievedDocument[];
  failureCode?: string;
  failureSummary?: string;
};

type Comparison = {
  testCaseId: string;
  query: string;
  baselineStatus: string;
  candidateStatus: string;
  baselineRecallAtK: number;
  candidateRecallAtK: number;
  recallDelta: number;
  baselineReciprocalRank: number;
  candidateReciprocalRank: number;
  reciprocalRankDelta: number;
  baselineLatencyMs: number;
  candidateLatencyMs: number;
  latencyDeltaMs: number;
  baselineForbiddenCount: number;
  candidateForbiddenCount: number;
  regressed: boolean;
  improved: boolean;
};

type RegressionEvaluation = {
  status: string;
  scenario: string;
  scenarioDescription: string;
  runId: string;
  suiteId: string;
  baselineRunId: string | null;
  backend: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  durationMs: number;
  results: CaseResult[];
  comparison: Comparison[];
  regressionCount: number;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  evaluation?: RegressionEvaluation;
};

function formatDate(value?: string): string {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(value: number): string {
  return value < 1000
    ? `${Math.round(value)} ms`
    : `${(value / 1000).toFixed(2)} s`;
}

function signedNumber(
  value: number,
  digits = 2
): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function StatusBadge({
  status,
}: {
  status: string;
}) {
  const normalised = status.toLowerCase();

  const success =
    normalised === "passed" ||
    normalised === "success" ||
    normalised === "improved";

  const failure =
    normalised === "failed" ||
    normalised === "error" ||
    normalised === "regressed";

  const classes = success
    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
    : failure
      ? "border-rose-400/20 bg-rose-400/10 text-rose-300"
      : "border-amber-400/20 bg-amber-400/10 text-amber-300";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${classes}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

function Metric({
  label,
  value,
  description,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  description: string;
  icon: typeof Activity;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#0e1420] p-5 transition-colors hover:border-white/[0.14]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">
            {label}
          </p>

          <p className="mt-3 text-3xl font-semibold tracking-tight text-white tabular-nums">
            {value}
          </p>
        </div>

        <div
          className={`rounded-xl border border-white/[0.07] p-3 ${tone}`}
        >
          <Icon size={19} />
        </div>
      </div>

      <p className="mt-4 text-xs leading-5 text-slate-500">
        {description}
      </p>
    </div>
  );
}

export default function RegressionPage() {
  const [dashboard, setDashboard] =
    useState<DashboardData | null>(null);

  const [selectedBaseline, setSelectedBaseline] =
    useState("");

  const [scenario, setScenario] =
    useState<Scenario>("exclude_expected_document");

  const [evaluation, setEvaluation] =
    useState<RegressionEvaluation | null>(null);

  const [loading, setLoading] = useState(true);
  const [creatingBaseline, setCreatingBaseline] =
    useState(false);

  const [runningScenario, setRunningScenario] =
    useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const baselines = useMemo(
    () =>
      (dashboard?.recentRuns ?? []).filter(
        (run) =>
          run.status === "passed" &&
          run.totalCases === 3
      ),
    [dashboard]
  );

  const effectiveBaseline =
    selectedBaseline || baselines[0]?.id || "";

  const refreshData = useCallback(async () => {
    const response = await fetch("/api/dashboard", {
      cache: "no-store",
    });

    const data =
      (await response.json()) as DashboardData & {
        error?: string;
      };

    if (!response.ok || data.ok !== true) {
      throw new Error(
        data.error ||
          "Could not load saved evaluation history."
      );
    }

    setDashboard(data);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/dashboard", {
            cache: "no-store",
          });

          const data =
            (await response.json()) as DashboardData & {
              error?: string;
            };

          if (!response.ok || data.ok !== true) {
            throw new Error(
              data.error ||
                "Could not load saved evaluation history."
            );
          }

          if (!cancelled) {
            setDashboard(data);
            setError("");
          }
        } catch (err) {
          if (!cancelled) {
            setError(
              err instanceof Error
                ? err.message
                : "Could not load evaluation history."
            );
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  async function handleRefresh() {
    setLoading(true);
    setError("");

    try {
      await refreshData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Refresh failed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateBaseline() {
    setCreatingBaseline(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/demo/run", {
        method: "POST",
        cache: "no-store",
      });

      const payload =
        (await response.json()) as ApiResponse;

      if (
        !response.ok ||
        !payload.ok ||
        !payload.evaluation
      ) {
        throw new Error(
          payload.error || "Could not create a baseline."
        );
      }

      const baseline = payload.evaluation;

      if (
        baseline.status !== "passed" ||
        baseline.totalCases !== 3
      ) {
        throw new Error(
          "Baseline creation did not pass all three search contracts. Resolve the failing contract before running regression tests."
        );
      }

      setSelectedBaseline(baseline.runId);
      setEvaluation(null);

      setNotice(
        `Baseline created successfully. Run ID: ${baseline.runId}`
      );

      await refreshData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Baseline creation failed."
      );
    } finally {
      setCreatingBaseline(false);
    }
  }

  async function handleRunRegression() {
    if (!effectiveBaseline) {
      setError(
        "Create a successful baseline before running a regression scenario."
      );
      return;
    }

    setRunningScenario(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        "/api/regression/run",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            scenario,
            baselineRunId: effectiveBaseline,
          }),
        }
      );

      const payload =
        (await response.json()) as ApiResponse;

      if (
        !response.ok ||
        !payload.ok ||
        !payload.evaluation
      ) {
        throw new Error(
          payload.error ||
            "Regression evaluation failed."
        );
      }

      setEvaluation(payload.evaluation);

      setNotice(
        payload.evaluation.regressionCount > 0
          ? `SiftGuard detected ${payload.evaluation.regressionCount} regression(s). The candidate failed as expected in this controlled scenario.`
          : "The candidate evaluation completed. Inspect the comparison results below."
      );

      await refreshData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Regression evaluation failed."
      );
    } finally {
      setRunningScenario(false);
    }
  }

  const selectedScenarioDescription =
    scenario === "exclude_expected_document"
      ? "Excludes the expected refund document from the actual Qdrant search. This should lower recall and cause the required-document assertion to fail."
      : "Applies the other tenant's filter to the refund test. This should retrieve Customer B's document, which the contract forbids.";

  return (
    <main className="min-h-screen bg-[#080b12] text-slate-100">
      <header className="border-b border-white/[0.07] bg-[#0a0e16]">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-teal-300/15 bg-teal-300/10 text-teal-200">
              <GitCompareArrows size={22} />
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-200">
                SIFTGUARD LAB
              </p>

              <h1 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">
                Regression &amp; Security
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/[0.05]"
            >
              <ArrowLeft size={16} />
              Overview
            </Link>

            <button
              type="button"
              onClick={handleRefresh}
              disabled={
                loading ||
                runningScenario ||
                creatingBaseline
              }
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/[0.05] disabled:opacity-50"
            >
              <RefreshCw
                size={15}
                className={
                  loading ? "animate-spin" : ""
                }
              />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-7 px-5 py-7 sm:px-8 sm:py-9">
        <section className="relative overflow-hidden rounded-3xl border border-violet-300/15 bg-gradient-to-br from-[#201938] via-[#131727] to-[#0e2430] p-6 sm:p-9">
          <div className="pointer-events-none absolute -right-16 -top-24 h-80 w-80 rounded-full bg-violet-400/[0.12] blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 right-[20%] h-44 w-72 rounded-full bg-teal-300/[0.08] blur-3xl" />

          <div className="relative grid gap-8 xl:grid-cols-[1fr_330px] xl:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-200/20 bg-violet-200/[0.07] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-violet-200">
                <Sparkles size={13} />
                Controlled failure testing
              </div>

              <h2 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
                Find the regression.
                <span className="block text-violet-200">
                  Explain the evidence.
                </span>
              </h2>

              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                Compare a trusted search baseline against a
                candidate that contains a deliberate fault.
                SiftGuard runs real vector queries, evaluates
                the assertions, and saves each result to
                Appwrite.
              </p>

              <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                  Real Qdrant retrieval
                </span>

                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                  Appwrite run history
                </span>

                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                  Explainable assertions
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#080b12]/60 p-5 backdrop-blur-sm">
              <p className="text-xs text-slate-400">
                Current baseline
              </p>

              <p className="mt-3 break-all font-mono text-sm text-white">
                {effectiveBaseline || "No baseline selected"}
              </p>

              <div className="mt-4 flex items-center gap-2">
                {effectiveBaseline ? (
                  <CheckCircle2
                    size={17}
                    className="text-emerald-300"
                  />
                ) : (
                  <AlertTriangle
                    size={17}
                    className="text-amber-300"
                  />
                )}

                <span className="text-xs text-slate-400">
                  {effectiveBaseline
                    ? "A successful three-case baseline is selected"
                    : "Create a successful baseline to begin"}
                </span>
              </div>

              <button
                type="button"
                onClick={handleCreateBaseline}
                disabled={
                  creatingBaseline || runningScenario
                }
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.1] disabled:opacity-50"
              >
                {creatingBaseline ? (
                  <LoaderCircle
                    size={16}
                    className="animate-spin"
                  />
                ) : (
                  <Database size={16} />
                )}

                {creatingBaseline
                  ? "Creating baseline..."
                  : "Create fresh baseline"}
              </button>
            </div>
          </div>
        </section>

        {notice && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] px-4 py-3 text-sm text-emerald-200"
          >
            <CheckCircle2
              size={18}
              className="mt-0.5 shrink-0"
            />
            <span className="break-all">{notice}</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-rose-400/20 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-200"
          >
            <AlertTriangle
              size={18}
              className="mt-0.5 shrink-0"
            />

            <div className="min-w-0 flex-1 break-words">
              {error}
            </div>

            <button
              type="button"
              onClick={() => setError("")}
              className="text-xs text-rose-200/70 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Valid baselines"
            value={
              loading && !dashboard
                ? "—"
                : String(baselines.length)
            }
            description="Passed three-case evaluations available for comparison"
            icon={Layers3}
            tone="bg-sky-400/10 text-sky-300"
          />

          <Metric
            label="Candidate outcome"
            value={
              evaluation
                ? `${evaluation.passedCases}/${evaluation.totalCases}`
                : "—"
            }
            description="Tests passing in the latest candidate scenario"
            icon={Activity}
            tone="bg-violet-400/10 text-violet-300"
          />

          <Metric
            label="Regressions detected"
            value={
              evaluation
                ? String(evaluation.regressionCount)
                : "—"
            }
            description="Baseline-pass to candidate-fail transitions"
            icon={ShieldAlert}
            tone="bg-rose-400/10 text-rose-300"
          />

          <Metric
            label="Candidate duration"
            value={
              evaluation
                ? formatDuration(evaluation.durationMs)
                : "—"
            }
            description="Measured complete evaluation pipeline"
            icon={Zap}
            tone="bg-amber-400/10 text-amber-300"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-white/[0.07] bg-[#0e1420] p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <ShieldAlert
                size={19}
                className="text-violet-300"
              />
              <h3 className="font-semibold text-white">
                Configure regression
              </h3>
            </div>

            <p className="mt-2 text-xs leading-6 text-slate-500">
              Select a known-good baseline and choose a
              controlled failure to inject into the test query.
            </p>

            <label
              htmlFor="baseline-select"
              className="mt-6 block text-xs font-medium uppercase tracking-[0.12em] text-slate-400"
            >
              Baseline evaluation
            </label>

            <div className="relative mt-2">
              <select
                id="baseline-select"
                value={effectiveBaseline}
                onChange={(event) =>
                  setSelectedBaseline(event.target.value)
                }
                className="w-full appearance-none rounded-xl border border-white/10 bg-[#090e17] px-3 py-3 pr-10 text-sm text-slate-100 outline-none transition-colors focus:border-teal-300/40"
              >
                <option value="">
                  Select a successful baseline
                </option>

                {baselines.map((run) => (
                  <option key={run.id} value={run.id}>
                    {formatDate(
                      run.finishedAt || run.createdAt
                    )}{" "}
                    · {run.passedCases}/{run.totalCases} passed
                    {" · "}
                    {run.id}
                  </option>
                ))}
              </select>

              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
            </div>

            <label
              htmlFor="scenario-select"
              className="mt-6 block text-xs font-medium uppercase tracking-[0.12em] text-slate-400"
            >
              Failure scenario
            </label>

            <div className="relative mt-2">
              <select
                id="scenario-select"
                value={scenario}
                onChange={(event) =>
                  setScenario(event.target.value as Scenario)
                }
                className="w-full appearance-none rounded-xl border border-white/10 bg-[#090e17] px-3 py-3 pr-10 text-sm text-slate-100 outline-none transition-colors focus:border-teal-300/40"
              >
                <option value="exclude_expected_document">
                  Missing expected document
                </option>

                <option value="wrong_tenant_filter">
                  Incorrect tenant filter
                </option>
              </select>

              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
            </div>

            <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.045] p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle
                  size={17}
                  className="mt-0.5 shrink-0 text-amber-300"
                />

                <p className="text-xs leading-6 text-slate-300">
                  {selectedScenarioDescription}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleRunRegression}
              disabled={
                runningScenario ||
                creatingBaseline ||
                !effectiveBaseline
              }
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-300 px-4 py-3.5 text-sm font-semibold text-[#06120f] shadow-lg shadow-teal-500/10 transition-colors hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {runningScenario ? (
                <LoaderCircle
                  size={17}
                  className="animate-spin"
                />
              ) : (
                <Play size={16} fill="currentColor" />
              )}

              {runningScenario
                ? "Running real vector tests..."
                : "Run regression scenario"}
            </button>

            <p className="mt-3 text-center text-[11px] leading-5 text-slate-500">
              Each run creates a new Appwrite evaluation record.
              Existing data is not deleted.
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-[#0e1420] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <GitCompareArrows
                    size={19}
                    className="text-teal-300"
                  />
                  <h3 className="font-semibold text-white">
                    Latest candidate
                  </h3>
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  Real metrics returned by the evaluation engine
                </p>
              </div>

              {evaluation && (
                <StatusBadge status={evaluation.status} />
              )}
            </div>

            {!evaluation ? (
              <div className="mt-5 flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-white/10 px-5 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-slate-400">
                  <GitCompareArrows size={22} />
                </div>

                <p className="mt-4 text-sm font-medium text-slate-200">
                  No candidate run in this session
                </p>

                <p className="mt-2 max-w-sm text-xs leading-6 text-slate-500">
                  Run a failure scenario to compare its search
                  metrics against a successful baseline.
                </p>
              </div>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                    <p className="text-xs text-slate-500">
                      Pass rate
                    </p>

                    <p className="mt-2 text-2xl font-semibold text-white">
                      {Math.round(evaluation.passRate)}%
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      Candidate suite
                    </p>
                  </div>

                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                    <p className="text-xs text-slate-500">
                      Tests failed
                    </p>

                    <p className="mt-2 text-2xl font-semibold text-rose-300">
                      {evaluation.failedCases}
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      Of {evaluation.totalCases} total
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex items-start gap-3 rounded-xl border border-violet-300/15 bg-violet-300/[0.05] p-4">
                  {evaluation.regressionCount > 0 ? (
                    <ShieldAlert
                      size={19}
                      className="mt-0.5 shrink-0 text-violet-200"
                    />
                  ) : (
                    <CheckCircle2
                      size={19}
                      className="mt-0.5 shrink-0 text-emerald-300"
                    />
                  )}

                  <div>
                    <p className="text-sm font-medium text-white">
                      {evaluation.regressionCount > 0
                        ? `${evaluation.regressionCount} regression(s) detected`
                        : "No baseline-pass regression detected"}
                    </p>

                    <p className="mt-1.5 break-all text-xs leading-5 text-slate-400">
                      {evaluation.scenarioDescription}
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-500">
                  <div className="flex items-center justify-between gap-3">
                    <span>Candidate run</span>
                    <span className="break-all font-mono text-slate-300">
                      {evaluation.runId}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span>Baseline run</span>
                    <span className="break-all font-mono text-slate-300">
                      {evaluation.baselineRunId ??
                        "Not available"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span>Backend</span>
                    <span className="text-slate-300">
                      {evaluation.backend}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {evaluation && (
          <>
            <section className="rounded-2xl border border-white/[0.07] bg-[#0e1420] p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Activity
                      size={19}
                      className="text-teal-300"
                    />
                    <h3 className="font-semibold text-white">
                      Baseline versus candidate
                    </h3>
                  </div>

                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Negative recall or ranking deltas indicate a
                    regression. Latency differences are informational
                    and depend on local model, system load and cache
                    state.
                  </p>
                </div>

                <span className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400">
                  {evaluation.comparison.length} comparisons
                </span>
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-3 font-medium">
                        Test
                      </th>
                      <th className="px-3 py-3 font-medium">
                        Recall@K
                      </th>
                      <th className="px-3 py-3 font-medium">
                        Reciprocal rank
                      </th>
                      <th className="px-3 py-3 font-medium">
                        Forbidden
                      </th>
                      <th className="px-3 py-3 font-medium">
                        Latency delta
                      </th>
                      <th className="px-3 py-3 font-medium">
                        Outcome
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {evaluation.comparison.map((item) => (
                      <tr
                        key={item.testCaseId}
                        className="border-b border-white/[0.05] last:border-b-0"
                      >
                        <td className="max-w-[250px] px-3 py-4">
                          <p className="font-medium leading-5 text-slate-200">
                            {item.testCaseId}
                          </p>

                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                            {item.query}
                          </p>
                        </td>

                        <td className="px-3 py-4">
                          <p className="text-xs text-slate-500">
                            {item.baselineRecallAtK.toFixed(2)}
                            {" → "}
                            {item.candidateRecallAtK.toFixed(2)}
                          </p>

                          <p
                            className={`mt-1 font-mono text-xs ${
                              item.recallDelta < 0
                                ? "text-rose-300"
                                : "text-emerald-300"
                            }`}
                          >
                            {signedNumber(item.recallDelta)}
                          </p>
                        </td>

                        <td className="px-3 py-4">
                          <p className="text-xs text-slate-500">
                            {item.baselineReciprocalRank.toFixed(2)}
                            {" → "}
                            {item.candidateReciprocalRank.toFixed(2)}
                          </p>

                          <p
                            className={`mt-1 font-mono text-xs ${
                              item.reciprocalRankDelta < 0
                                ? "text-rose-300"
                                : "text-emerald-300"
                            }`}
                          >
                            {signedNumber(
                              item.reciprocalRankDelta
                            )}
                          </p>
                        </td>

                        <td className="px-3 py-4">
                          <span
                            className={
                              item.candidateForbiddenCount > 0
                                ? "font-semibold text-rose-300"
                                : "text-slate-400"
                            }
                          >
                            {item.baselineForbiddenCount}
                            {" → "}
                            {item.candidateForbiddenCount}
                          </span>
                        </td>

                        <td className="px-3 py-4">
                          <span
                            className={`inline-flex items-center gap-1 font-mono text-xs ${
                              item.latencyDeltaMs > 0
                                ? "text-amber-300"
                                : "text-slate-300"
                            }`}
                          >
                            {item.latencyDeltaMs > 0 ? (
                              <ArrowUpRight size={14} />
                            ) : (
                              <ArrowDownRight size={14} />
                            )}

                            {signedNumber(
                              item.latencyDeltaMs,
                              0
                            )}{" "}
                            ms
                          </span>
                        </td>

                        <td className="px-3 py-4">
                          {item.regressed ? (
                            <StatusBadge status="regressed" />
                          ) : item.improved ? (
                            <StatusBadge status="improved" />
                          ) : (
                            <StatusBadge status="unchanged" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-white/[0.07] bg-[#0e1420] p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <Database
                  size={19}
                  className="text-violet-300"
                />
                <h3 className="font-semibold text-white">
                  Candidate evidence
                </h3>
              </div>

              <p className="mt-2 text-xs leading-5 text-slate-500">
                The document IDs and failure reasons below come
                from the actual candidate result, not from a
                hardcoded demonstration.
              </p>

              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                {evaluation.results.map((result) => (
                  <article
                    key={result.testCaseId}
                    className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium leading-5 text-slate-200">
                          {result.testCaseId}
                        </p>

                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          {result.query}
                        </p>
                      </div>

                      <StatusBadge status={result.status} />
                    </div>

                    {result.failureSummary && (
                      <div className="mt-4 rounded-lg border border-rose-300/15 bg-rose-300/[0.05] p-3">
                        <p className="text-xs font-semibold text-rose-200">
                          {result.failureCode ??
                            "Assertion failed"}
                        </p>

                        <p className="mt-2 text-xs leading-5 text-slate-400">
                          {result.failureSummary}
                        </p>
                      </div>
                    )}

                    <div className="mt-4 space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Retrieved documents
                      </p>

                      {result.retrieved.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          No documents were retrieved.
                        </p>
                      ) : (
                        result.retrieved.map((document) => (
                          <div
                            key={document.documentId}
                            className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-xs text-slate-200">
                                {document.title}
                              </p>

                              <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
                                {document.documentId}
                              </p>
                            </div>

                            <span className="shrink-0 font-mono text-xs text-teal-200">
                              {document.score.toFixed(3)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-slate-500">
                      <span>
                        Recall {result.recallAtK.toFixed(2)}
                      </span>

                      <span>
                        MRR {result.reciprocalRank.toFixed(2)}
                      </span>

                      <span className="inline-flex items-center gap-1">
                        <Clock3 size={12} />
                        {formatDuration(result.latencyMs)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        <footer className="flex flex-col justify-between gap-2 border-t border-white/[0.07] py-5 text-[11px] text-slate-600 sm:flex-row sm:items-center">
          <span>
            SiftGuard · Regression and security evaluation
          </span>

          <span className="inline-flex items-center gap-2">
            <Database size={13} />
            Appwrite TablesDB · Qdrant · Ollama
          </span>
        </footer>
      </div>
    </main>
  );
}