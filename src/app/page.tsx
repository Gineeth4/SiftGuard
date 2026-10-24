"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  FileCheck2,
  GitBranch,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  XCircle,
  Zap,
} from "lucide-react";

type RetrievedDocument = {
  documentId: string;
  title: string;
  score: number;
};

type TestResult = {
  id: string;
  runId: string;
  testCaseId: string;
  query: string;
  status: string;
  recallAtK: number;
  reciprocalRank: number;
  latencyMs: number;
  expectedCount: number;
  retrievedCount: number;
  forbiddenCount: number;
  failureCode: string;
  failureSummary: string;
  actualDocumentIds: string[];
  retrieved: RetrievedDocument[];
  createdAt: string;
};

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
    totalSuites: number;
    totalCases: number;
    totalDocuments: number;
    totalRuns: number;
    latestPassRate: number;
    latestRunStatus: string;
    latestTotalCases: number;
    latestPassedCases: number;
    latestFailedCases: number;
    latestForbiddenCount: number;
    averageLatencyMs: number;
  };
  latestRun: EvaluationRun | null;
  recentRuns: EvaluationRun[];
  latestRunResults: TestResult[];
  recentResults: TestResult[];
};

type HealthData = {
  ok: boolean;
  services: Record<
    string,
    {
      ok: boolean;
      modelAvailable?: boolean;
      tableCount?: number;
      installedModels?: string[];
    }
  >;
};

type ApiError = {
  ok?: boolean;
  error?: string;
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
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;

  return `${(ms / 1000).toFixed(2)} s`;
}

function percentage(value: number): string {
  return `${Math.round(value)}%`;
}

function StatusBadge({ status }: { status: string }) {
  const normalised = status.toLowerCase();

  const passed =
    normalised === "passed" ||
    normalised === "success" ||
    normalised === "available";

  const failed =
    normalised === "failed" ||
    normalised === "error";

  const styles = passed
    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
    : failed
      ? "border-rose-400/20 bg-rose-400/10 text-rose-300"
      : "border-amber-400/20 bg-amber-400/10 text-amber-300";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${styles}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status.replaceAll("-", " ")}
    </span>
  );
}

function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  description: string;
  icon: typeof Activity;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#0e1420] p-5 transition-colors hover:border-white/[0.13]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-white tabular-nums">
            {value}
          </p>
        </div>

        <div
          className={`rounded-xl border border-white/[0.07] p-2.5 ${accent}`}
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

function ServiceStatus({
  name,
  detail,
  ok,
}: {
  name: string;
  detail: string;
  ok: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-3">
      {ok ? (
        <CheckCircle2
          size={18}
          className="shrink-0 text-emerald-400"
        />
      ) : (
        <CircleAlert
          size={18}
          className="shrink-0 text-amber-400"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-200">
          {name}
        </p>

        <p className="truncate text-xs text-slate-500">
          {detail}
        </p>
      </div>

      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          ok ? "bg-emerald-400" : "bg-amber-400"
        }`}
      />
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 px-5 py-12 text-center">
      <Search size={25} className="text-slate-500" />

      <p className="mt-4 text-sm font-medium text-slate-200">
        {title}
      </p>

      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
        {description}
      </p>
    </div>
  );
}

export default function HomePage() {
  const [data, setData] = useState<DashboardData | null>(
    null
  );

  const [health, setHealth] = useState<HealthData | null>(
    null
  );

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expandedResult, setExpandedResult] = useState<
    string | null
  >(null);

  const loadDashboard = useCallback(
    async (showLoader = false) => {
      if (showLoader) {
        setLoading(true);
      }

      try {
        const response = await fetch("/api/dashboard", {
          cache: "no-store",
        });

        const payload = (await response.json()) as
          | DashboardData
          | ApiError;

        if (!response.ok || payload.ok !== true) {
          throw new Error(
            ("error" in payload && payload.error) ||
              "Could not load dashboard data."
          );
        }

        setData(payload as DashboardData);
        setError("");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Dashboard request failed."
        );
      } finally {
        // Always clear the initial loading state, including
        // when the initial request was made with showLoader=false.
        setLoading(false);
      }
    },
    []
  );

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Health check request failed.");
      }

      const result =
        (await response.json()) as HealthData;

      setHealth(result);
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    // Defer the initial network requests until after this effect
    // finishes. This avoids synchronous state updates in an effect.
    const timer = window.setTimeout(() => {
      void loadDashboard(false);
      void loadHealth();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadDashboard, loadHealth]);

  async function handleRunEvaluation() {
    setRunning(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/demo/run", {
        method: "POST",
        cache: "no-store",
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        evaluation?: {
          status?: string;
          passRate?: number;
          passedCases?: number;
          failedCases?: number;
          totalCases?: number;
        };
      };

      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.error || "Evaluation failed."
        );
      }

      const result = payload.evaluation;

      setNotice(
        `Evaluation ${result?.status ?? "completed"} · ` +
          `${result?.passedCases ?? 0}/` +
          `${result?.totalCases ?? 0} tests passed.`
      );

      setExpandedResult(null);

      await Promise.all([
        loadDashboard(false),
        loadHealth(),
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not run the evaluation."
      );
    } finally {
      setRunning(false);
    }
  }

  async function handleRefresh() {
    setNotice("");

    await Promise.all([
      loadDashboard(true),
      loadHealth(),
    ]);
  }

  const stats = data?.stats;

  const latestResults = data?.latestRunResults ?? [];
  const fallbackResults = data?.recentResults ?? [];

  const displayedResults =
    latestResults.length > 0
      ? latestResults
      : fallbackResults.slice(0, 5);

  const connectedServices = health
    ? Object.values(health.services).filter(
        (service) =>
          service.ok &&
          (service.modelAvailable === undefined ||
            service.modelAvailable)
      ).length
    : 0;

  const history = data?.recentRuns ?? [];

  return (
    <main
      id="overview"
      className="min-h-screen bg-[#080b12] text-slate-100 selection:bg-teal-300/30"
    >
      <div className="flex min-h-screen">
        <aside className="hidden w-[248px] shrink-0 border-r border-white/[0.07] bg-[#0a0e16] lg:flex lg:flex-col">
          <div className="flex h-[76px] items-center gap-3 border-b border-white/[0.07] px-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-300 text-slate-950 shadow-lg shadow-teal-400/10">
              <ShieldCheck size={23} />
            </div>

            <div>
              <p className="text-base font-bold tracking-[0.13em] text-white">
                SIFTGUARD
              </p>

              <p className="mt-0.5 text-[10px] uppercase tracking-[0.19em] text-slate-500">
                Retrieval quality platform
              </p>
            </div>
          </div>

          <div className="px-4 pt-7">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Workspace
            </p>

            <nav className="mt-3 space-y-1">
              <a
                href="#overview"
                className="flex items-center gap-3 rounded-xl border border-teal-300/15 bg-teal-300/[0.09] px-3 py-3 text-sm font-medium text-teal-200"
              >
                <LayoutDashboard size={18} />
                Overview
                <ChevronRight
                  size={16}
                  className="ml-auto"
                />
              </a>

              <a
                href="#latest-results"
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-400 transition-colors hover:bg-white/[0.045] hover:text-white"
              >
                <FileCheck2 size={18} />
                Search contracts
              </a>

              <a
                href="#run-history"
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-400 transition-colors hover:bg-white/[0.045] hover:text-white"
              >
                <Activity size={18} />
                Run history
              </a>

              <a
                href="#pipeline"
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-400 transition-colors hover:bg-white/[0.045] hover:text-white"
              >
                <GitBranch size={18} />
                Architecture
              </a>
            </nav>
          </div>

          <div className="mt-auto space-y-4 border-t border-white/[0.07] p-5">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                <LockKeyhole
                  size={15}
                  className="text-teal-300"
                />
                Private server credentials
              </div>

              <p className="mt-2 text-[11px] leading-5 text-slate-500">
                Database requests run through the
                server-side API.
              </p>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Development build</span>

              <span className="rounded-md border border-white/10 px-1.5 py-0.5">
                v0.1
              </span>
            </div>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex min-h-[76px] items-center justify-between gap-4 border-b border-white/[0.07] bg-[#080b12]/90 px-5 backdrop-blur-xl sm:px-8">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Workspace</span>
                <ChevronRight size={13} />
                <span className="text-slate-300">
                  Overview
                </span>
              </div>

              <h1 className="mt-1 text-lg font-semibold tracking-tight text-white">
                Retrieval observability
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading || running}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw
                  size={15}
                  className={
                    loading ? "animate-spin" : ""
                  }
                />

                <span className="hidden sm:inline">
                  Refresh
                </span>
              </button>

              <button
                type="button"
                onClick={handleRunEvaluation}
                disabled={running}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-300 px-3.5 py-2.5 text-sm font-semibold text-[#06120f] shadow-lg shadow-teal-500/10 transition-colors hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
              >
                {running ? (
                  <LoaderCircle
                    size={16}
                    className="animate-spin"
                  />
                ) : (
                  <Play size={15} fill="currentColor" />
                )}

                {running
                  ? "Evaluating..."
                  : "Run evaluation"}
              </button>
            </div>
          </header>

          <div className="mx-auto max-w-[1600px] space-y-7 px-5 py-7 sm:px-8 sm:py-9">
            <section className="relative overflow-hidden rounded-3xl border border-teal-300/15 bg-gradient-to-br from-[#102a2c] via-[#101b27] to-[#121323] p-6 sm:p-9">
              <div className="pointer-events-none absolute -right-10 -top-24 h-72 w-72 rounded-full bg-teal-300/[0.09] blur-3xl" />
              <div className="pointer-events-none absolute bottom-0 right-[20%] h-36 w-64 rounded-full bg-violet-400/[0.06] blur-3xl" />

              <div className="relative grid gap-8 xl:grid-cols-[1fr_290px] xl:items-center">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-200/[0.07] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-teal-200">
                    <Sparkles size={13} />
                    Semantic search quality gate
                  </div>

                  <h2 className="mt-5 max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
                    Catch search regressions
                    <span className="block text-teal-200">
                      before your users do.
                    </span>
                  </h2>

                  <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                    Test retrieval quality, enforce expected
                    and forbidden results, and preserve
                    evidence of every evaluation. One
                    reproducible workflow for your AI search
                    application.
                  </p>

                  <div className="mt-7 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleRunEvaluation}
                      disabled={running}
                      className="inline-flex items-center gap-2 rounded-xl bg-teal-300 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-teal-200 disabled:opacity-60"
                    >
                      <Play size={16} fill="currentColor" />
                      Run test suite
                      <ArrowRight size={15} />
                    </button>

                    <a
                      href="#latest-results"
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.035] px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]"
                    >
                      Inspect results
                      <ChevronRight size={16} />
                    </a>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-[#080d16]/60 p-5 backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-400">
                      Latest evaluation
                    </span>

                    {data?.latestRun ? (
                      <StatusBadge
                        status={data.latestRun.status}
                      />
                    ) : (
                      <span className="text-xs text-slate-500">
                        Not run
                      </span>
                    )}
                  </div>

                  <div className="mt-6 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-4xl font-semibold tracking-tight text-white tabular-nums">
                        {percentage(
                          stats?.latestPassRate ?? 0
                        )}
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        Latest suite pass rate
                      </p>
                    </div>

                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                      <ShieldCheck
                        size={27}
                        className="text-teal-200"
                      />
                    </div>
                  </div>

                  <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-300 transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            0,
                            stats?.latestPassRate ?? 0
                          )
                        )}%`,
                      }}
                    />
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                    <span>
                      {stats?.latestPassedCases ?? 0} passed
                    </span>

                    <span>
                      {stats?.latestFailedCases ?? 0} failed
                    </span>
                  </div>
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
                <span>{notice}</span>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-xl border border-rose-400/20 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-200"
              >
                <CircleAlert
                  size={18}
                  className="mt-0.5 shrink-0"
                />

                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    An operation needs attention
                  </p>

                  <p className="mt-1 break-words text-rose-200/80">
                    {error}
                  </p>
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
              <MetricCard
                label="Test contracts"
                value={
                  loading && !data
                    ? "—"
                    : String(stats?.totalCases ?? 0)
                }
                description={`${stats?.totalSuites ?? 0} suites configured`}
                icon={FileCheck2}
                accent="bg-sky-400/10 text-sky-300"
              />

              <MetricCard
                label="Indexed documents"
                value={
                  loading && !data
                    ? "—"
                    : String(stats?.totalDocuments ?? 0)
                }
                description="Document records in Appwrite"
                icon={Database}
                accent="bg-violet-400/10 text-violet-300"
              />

              <MetricCard
                label="Retrieval latency"
                value={
                  stats
                    ? formatDuration(stats.averageLatencyMs)
                    : "—"
                }
                description="Average of loaded saved results"
                icon={Zap}
                accent="bg-amber-400/10 text-amber-300"
              />

              <MetricCard
                label="Forbidden results"
                value={String(
                  stats?.latestForbiddenCount ?? 0
                )}
                description="Detected in the latest evaluation"
                icon={LockKeyhole}
                accent="bg-emerald-400/10 text-emerald-300"
              />
            </section>

            <section className="rounded-2xl border border-white/[0.07] bg-[#0e1420] p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Server
                      size={18}
                      className="text-teal-300"
                    />

                    <h3 className="font-semibold text-white">
                      Connected services
                    </h3>
                  </div>

                  <p className="mt-1.5 text-xs text-slate-500">
                    Live checks against the configured
                    development services.
                  </p>
                </div>

                <span className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-400">
                  {health
                    ? `${connectedServices}/3 ready`
                    : "Checking services"}
                </span>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <ServiceStatus
                  name="Appwrite TablesDB"
                  detail={
                    health?.services.appwrite?.ok
                      ? `${health.services.appwrite.tableCount ?? 0} tables found`
                      : "Connection needs attention"
                  }
                  ok={
                    health?.services.appwrite?.ok ?? false
                  }
                />

                <ServiceStatus
                  name="Qdrant vector engine"
                  detail={
                    health?.services.qdrant?.ok
                      ? "Vector search available"
                      : "Connection needs attention"
                  }
                  ok={
                    health?.services.qdrant?.ok ?? false
                  }
                />

                <ServiceStatus
                  name="Ollama embeddings"
                  detail={
                    health?.services.ollama?.modelAvailable
                      ? "Embedding model ready"
                      : "Model needs attention"
                  }
                  ok={
                    health?.services.ollama?.ok === true &&
                    health.services.ollama.modelAvailable === true
                  }
                />
              </div>
            </section>

            <section className="grid gap-6 2xl:grid-cols-[1.5fr_1fr]">
              <div
                id="latest-results"
                className="scroll-mt-24 rounded-2xl border border-white/[0.07] bg-[#0e1420] p-5 sm:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Search
                        size={18}
                        className="text-teal-300"
                      />

                      <h3 className="font-semibold text-white">
                        Latest test results
                      </h3>
                    </div>

                    <p className="mt-1.5 text-xs text-slate-500">
                      Real results saved in Appwrite.
                    </p>
                  </div>

                  <span className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-400">
                    {displayedResults.length} shown
                  </span>
                </div>

                <div className="mt-5 space-y-3">
                  {displayedResults.length === 0 ? (
                    <EmptyState
                      title="No evaluation results yet"
                      description="Run the suite to create and save your first set of results."
                    />
                  ) : (
                    displayedResults.map((result) => {
                      const expanded =
                        expandedResult === result.id;

                      return (
                        <div
                          key={result.id}
                          className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedResult(
                                expanded ? null : result.id
                              )
                            }
                            className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-white/[0.025]"
                          >
                            <div className="mt-0.5">
                              {result.status === "passed" ? (
                                <CheckCircle2
                                  size={18}
                                  className="text-emerald-400"
                                />
                              ) : (
                                <XCircle
                                  size={18}
                                  className="text-rose-400"
                                />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="text-sm leading-6 text-slate-200">
                                {result.query}
                              </p>

                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
                                <span>
                                  Recall@K:{" "}
                                  {result.recallAtK.toFixed(2)}
                                </span>

                                <span>
                                  MRR:{" "}
                                  {result.reciprocalRank.toFixed(2)}
                                </span>

                                <span>
                                  {formatDuration(
                                    result.latencyMs
                                  )}
                                </span>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                              <StatusBadge
                                status={result.status}
                              />

                              <ChevronRight
                                size={16}
                                className={`text-slate-500 transition-transform ${
                                  expanded ? "rotate-90" : ""
                                }`}
                              />
                            </div>
                          </button>

                          {expanded && (
                            <div className="border-t border-white/[0.07] bg-black/10 p-4">
                              <div className="grid gap-3 sm:grid-cols-3">
                                <div className="rounded-lg bg-white/[0.035] p-3">
                                  <p className="text-xs text-slate-500">
                                    Required documents
                                  </p>

                                  <p className="mt-1 text-xl font-semibold text-white">
                                    {result.expectedCount}
                                  </p>
                                </div>

                                <div className="rounded-lg bg-white/[0.035] p-3">
                                  <p className="text-xs text-slate-500">
                                    Retrieved documents
                                  </p>

                                  <p className="mt-1 text-xl font-semibold text-white">
                                    {result.retrievedCount}
                                  </p>
                                </div>

                                <div className="rounded-lg bg-white/[0.035] p-3">
                                  <p className="text-xs text-slate-500">
                                    Forbidden matches
                                  </p>

                                  <p className="mt-1 text-xl font-semibold text-white">
                                    {result.forbiddenCount}
                                  </p>
                                </div>
                              </div>

                              <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
                                Retrieved documents
                              </p>

                              {result.retrieved.length > 0 ? (
                                <div className="mt-2 space-y-2">
                                  {result.retrieved.map(
                                    (document) => (
                                      <div
                                        key={document.documentId}
                                        className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2.5"
                                      >
                                        <div className="min-w-0">
                                          <p className="truncate text-sm text-slate-200">
                                            {document.title}
                                          </p>

                                          <p className="mt-1 truncate text-[11px] text-slate-500">
                                            {document.documentId}
                                          </p>
                                        </div>

                                        <span className="shrink-0 font-mono text-xs text-teal-200">
                                          {document.score.toFixed(3)}
                                        </span>
                                      </div>
                                    )
                                  )}
                                </div>
                              ) : (
                                <p className="mt-2 text-xs text-slate-500">
                                  Detailed retrieved-document
                                  data is not available for this result.
                                </p>
                              )}

                              {result.failureSummary && (
                                <div className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-3 text-sm text-rose-200">
                                  {result.failureSummary}

                                  {result.failureCode && (
                                    <p className="mt-1 text-xs text-rose-200/60">
                                      {result.failureCode}
                                    </p>
                                  )}
                                </div>
                              )}

                              <p className="mt-3 text-[11px] text-slate-500">
                                Saved {formatDate(result.createdAt)}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div
                id="run-history"
                className="scroll-mt-24 rounded-2xl border border-white/[0.07] bg-[#0e1420] p-5 sm:p-6"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <BarChart3
                        size={18}
                        className="text-violet-300"
                      />

                      <h3 className="font-semibold text-white">
                        Evaluation history
                      </h3>
                    </div>

                    <p className="mt-1.5 text-xs text-slate-500">
                      Most recent saved runs
                    </p>
                  </div>

                  <span className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-400">
                    {stats?.totalRuns ?? 0} total
                  </span>
                </div>

                <div className="mt-5 space-y-1">
                  {history.length === 0 ? (
                    <EmptyState
                      title="No saved runs"
                      description="Your completed evaluation history will appear here."
                    />
                  ) : (
                    history.slice(0, 8).map((run, index) => (
                      <div
                        key={run.id}
                        className="flex gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-white/[0.025]"
                      >
                        <div className="flex flex-col items-center">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                              run.status === "passed"
                                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                                : run.status === "failed"
                                  ? "border-rose-400/20 bg-rose-400/10 text-rose-300"
                                  : "border-amber-400/20 bg-amber-400/10 text-amber-300"
                            }`}
                          >
                            {run.status === "passed" ? (
                              <CheckCircle2 size={16} />
                            ) : run.status === "failed" ? (
                              <XCircle size={16} />
                            ) : (
                              <Clock3 size={16} />
                            )}
                          </div>

                          {index <
                            Math.min(history.length, 8) - 1 && (
                            <div className="mt-1 w-px flex-1 bg-white/[0.08]" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1 pb-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-slate-200">
                              {run.totalCases}{" "}
                              {run.totalCases === 1
                                ? "test"
                                : "tests"}{" "}
                              evaluated
                            </p>

                            <StatusBadge status={run.status} />
                          </div>

                          <p className="mt-1 text-xs text-slate-500">
                            {formatDate(
                              run.finishedAt || run.createdAt
                            )}
                          </p>

                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-xs text-slate-400">
                              {run.passedCases} passed ·{" "}
                              {run.failedCases} failed
                            </span>

                            <span className="text-xs font-semibold text-slate-300">
                              {percentage(run.passRate)}
                            </span>
                          </div>

                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                            <div
                              className={`h-full rounded-full ${
                                run.status === "passed"
                                  ? "bg-emerald-400"
                                  : "bg-rose-400"
                              }`}
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.max(0, run.passRate)
                                )}%`,
                              }}
                            />
                          </div>

                          {run.summary && (
                            <p className="mt-2 text-xs leading-5 text-slate-500">
                              {run.summary}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section
              id="pipeline"
              className="scroll-mt-24 rounded-2xl border border-white/[0.07] bg-[#0e1420] p-5 sm:p-6"
            >
              <div className="flex items-center gap-2">
                <GitBranch
                  size={18}
                  className="text-teal-300"
                />

                <h3 className="font-semibold text-white">
                  SiftGuard evaluation pipeline
                </h3>
              </div>

              <p className="mt-1.5 text-xs leading-5 text-slate-500">
                The services that power each completed test run.
              </p>

              <div className="mt-6 grid gap-3 md:grid-cols-4">
                {[
                  {
                    step: "01",
                    title: "Appwrite TablesDB",
                    body: "Stores search contracts, document metadata, runs and results.",
                    icon: Database,
                  },
                  {
                    step: "02",
                    title: "Ollama embeddings",
                    body: "Converts documents and test queries into vectors.",
                    icon: Sparkles,
                  },
                  {
                    step: "03",
                    title: "Qdrant retrieval",
                    body: "Finds relevant documents using vector similarity and filters.",
                    icon: Search,
                  },
                  {
                    step: "04",
                    title: "Evaluation engine",
                    body: "Calculates metrics, checks assertions and records outcomes.",
                    icon: Terminal,
                  },
                ].map((item) => (
                  <div
                    key={item.step}
                    className="relative rounded-xl border border-white/[0.07] bg-white/[0.02] p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-slate-600">
                        {item.step}
                      </span>

                      <item.icon
                        size={18}
                        className="text-teal-300"
                      />
                    </div>

                    <h4 className="mt-4 text-sm font-semibold text-slate-200">
                      {item.title}
                    </h4>

                    <p className="mt-2 text-xs leading-6 text-slate-500">
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <footer className="flex flex-col justify-between gap-2 border-t border-white/[0.07] py-5 text-[11px] text-slate-600 sm:flex-row sm:items-center">
              <span>
                SiftGuard · Semantic search quality and
                regression testing
              </span>

              <span className="flex items-center gap-2">
                <Activity size={13} />
                Metrics loaded from persisted evaluations
              </span>
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}