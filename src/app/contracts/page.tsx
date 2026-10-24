
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

interface Suite {
  id: string;
  name: string;
  description: string;
  status: string;
  minimumRecallAtK: number;
  topK: number;
}

interface DocumentOption {
  id: string;
  title: string;
  category: string;
  tenantId: string;
  sourceUrl: string;
}

interface TestCase {
  id: string;
  query: string;
  category: string;
  tenantId: string;
  topK: number;
  enabled: boolean;
  suiteId: string;
  requiredCount: number;
  forbiddenCount: number;
}

interface Catalog {
  suites: Suite[];
  documents: DocumentOption[];
  cases: TestCase[];
}

interface EvaluationResult {
  testCaseId: string;
  query: string;
  status: "passed" | "failed";
  recallAtK: number;
  reciprocalRank: number;
  forbiddenCount: number;
  retrieved: Array<{
    documentId: string;
    title: string;
    score: number;
  }>;
  failureCode?: string;
  failureSummary?: string;
}

interface Evaluation {
  status: "passed" | "failed";
  runId: string;
  suiteId: string;
  suiteName: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  durationMs: number;
  results: EvaluationResult[];
}

interface ApiError {
  ok: false;
  error: string;
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json();

  if (!response.ok) {
    const errorPayload = payload as Partial<ApiError>;
    throw new Error(errorPayload.error ?? `Request failed (${response.status}).`);
  }

  return payload as T;
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className="mt-2 break-words text-xl font-semibold text-white">
        {value}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const success = status === "passed";

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
        success
          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
          : "border-rose-400/25 bg-rose-400/10 text-rose-300"
      }`}
    >
      {status.toUpperCase()}
    </span>
  );
}

export default function ContractsPage() {
  const [catalog, setCatalog] = useState<Catalog>({
    suites: [],
    documents: [],
    cases: [],
  });
  const [suiteId, setSuiteId] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("support-policy");
  const [tenantId, setTenantId] = useState("demo-tenant");
  const [topK, setTopK] = useState(3);
  const [requiredDocumentIds, setRequiredDocumentIds] = useState<string[]>([]);
  const [forbiddenDocumentIds, setForbiddenDocumentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);

  const refreshCatalog = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const response = await fetch("/api/contracts", {
        cache: "no-store",
      });
      const payload = await parseJson<Catalog & { ok: true }>(response);

      setCatalog({
        suites: payload.suites,
        documents: payload.documents,
        cases: payload.cases,
      });

      setSuiteId((current) =>
        payload.suites.some((suite) => suite.id === current)
          ? current
          : payload.suites[0]?.id ?? ""
      );

      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load the contracts catalog."
      );
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshCatalog();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [refreshCatalog]);

  const selectedSuite = useMemo(
    () => catalog.suites.find((suite) => suite.id === suiteId),
    [catalog.suites, suiteId]
  );

  const suiteCases = useMemo(
    () => catalog.cases.filter((testCase) => testCase.suiteId === suiteId),
    [catalog.cases, suiteId]
  );

  const requiredDocuments = useMemo(
    () => catalog.documents.filter((document) => document.tenantId === tenantId),
    [catalog.documents, tenantId]
  );

  function toggleDocument(
    documentId: string,
    kind: "required" | "forbidden",
    checked: boolean
  ) {
    const update =
      kind === "required"
        ? setRequiredDocumentIds
        : setForbiddenDocumentIds;

    update((current) =>
      checked
        ? [...new Set([...current, documentId])]
        : current.filter((id) => id !== documentId)
    );

    setError("");
  }

  async function handleCreateCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setEvaluation(null);

    if (!suiteId) {
      setError("Select an active suite first.");
      return;
    }

    if (requiredDocumentIds.length === 0) {
      setError("Choose at least one required document.");
      return;
    }

    if (
      requiredDocumentIds.some((id) => forbiddenDocumentIds.includes(id))
    ) {
      setError("A document cannot be both required and forbidden.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suiteId,
          query,
          category,
          tenantId,
          topK,
          requiredDocumentIds,
          forbiddenDocumentIds,
        }),
      });

      const payload = await parseJson<{
        ok: true;
        testCase: { id: string; requiredCount: number; forbiddenCount: number };
      }>(response);

      setNotice(
        `Contract created: ${payload.testCase.id}. ` +
          `${payload.testCase.requiredCount} required and ` +
          `${payload.testCase.forbiddenCount} forbidden rule(s) saved.`
      );
      setQuery("");
      setRequiredDocumentIds([]);
      setForbiddenDocumentIds([]);
      await refreshCatalog(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save the contract."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleEvaluate() {
    if (!suiteId) {
      setError("Select an active suite first.");
      return;
    }

    setEvaluating(true);
    setError("");
    setNotice("");
    setEvaluation(null);

    try {
      const response = await fetch("/api/contracts/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suiteId }),
      });

      const payload = await parseJson<{
        ok: true;
        evaluation: Evaluation;
      }>(response);

      setEvaluation(payload.evaluation);
      setNotice(
        payload.evaluation.status === "passed"
          ? "Every enabled contract in this suite passed."
          : "The evaluation found retrieval contract failures."
      );

      await refreshCatalog(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not evaluate the suite."
      );
    } finally {
      setEvaluating(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#080d18] text-slate-100">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <header className="flex flex-col justify-between gap-5 border-b border-white/10 pb-7 md:flex-row md:items-end">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
              SiftGuard · Phase 3
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Retrieval contracts
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              Define what search must return and what it must never expose.
              Contracts and evaluation results are persisted in Appwrite.
            </p>
          </div>

          <nav className="flex flex-wrap gap-3 text-sm">
            <Link
              href="/"
              className="rounded-lg border border-white/10 px-4 py-2 text-slate-300 hover:bg-white/5"
            >
              Overview
            </Link>
            <Link
              href="/regression"
              className="rounded-lg border border-white/10 px-4 py-2 text-slate-300 hover:bg-white/5"
            >
              Regression Lab
            </Link>
          </nav>
        </header>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-200"
          >
            {error}
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="mt-6 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4 text-sm text-cyan-100"
          >
            {notice}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-sm text-slate-400">
            Loading Appwrite suites, test cases and documents…
          </div>
        ) : (
          <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
            <section className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Create a contract
                    </h2>
                    <p className="mt-1 text-sm text-slate-400">
                      Create a saved test case with explicit document expectations.
                    </p>
                  </div>
                  <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.07] px-3 py-1 text-xs text-cyan-200">
                    Appwrite-backed
                  </span>
                </div>

                {catalog.suites.length === 0 ? (
                  <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm text-amber-100">
                    No suite exists yet. Run a baseline from the Overview
                    page first to seed the demo suite and document corpus.
                  </div>
                ) : catalog.documents.length === 0 ? (
                  <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm text-amber-100">
                    No active documents are available. Seed the demo corpus
                    before creating contracts.
                  </div>
                ) : (
                  <form onSubmit={handleCreateCase} className="mt-6 space-y-5">
                    <div>
                      <label
                        htmlFor="suiteId"
                        className="mb-2 block text-sm font-medium text-slate-300"
                      >
                        Test suite
                      </label>
                      <select
                        id="suiteId"
                        value={suiteId}
                        onChange={(event) => setSuiteId(event.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-3 text-sm text-white outline-none focus:border-cyan-300/60"
                        required
                      >
                        {catalog.suites.map((suite) => (
                          <option key={suite.id} value={suite.id}>
                            {suite.name} · {suite.status}
                          </option>
                        ))}
                      </select>
                      {selectedSuite && (
                        <p className="mt-2 text-xs text-slate-500">
                          Minimum recall:{" "}
                          {selectedSuite.minimumRecallAtK.toFixed(2)} ·
                          Default top K: {selectedSuite.topK}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="query"
                        className="mb-2 block text-sm font-medium text-slate-300"
                      >
                        User query to test
                      </label>
                      <textarea
                        id="query"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        maxLength={2000}
                        rows={3}
                        required
                        placeholder="Example: How can I return an order and get my money back?"
                        className="w-full resize-y rounded-xl border border-white/10 bg-[#0b1220] px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/60"
                      />
                      <div className="mt-1 text-right text-xs text-slate-500">
                        {query.length}/2000
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <label
                          htmlFor="category"
                          className="mb-2 block text-sm font-medium text-slate-300"
                        >
                          Category
                        </label>
                        <input
                          id="category"
                          value={category}
                          onChange={(event) => setCategory(event.target.value)}
                          maxLength={100}
                          className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-3 text-sm text-white outline-none focus:border-cyan-300/60"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="tenantId"
                          className="mb-2 block text-sm font-medium text-slate-300"
                        >
                          Tenant ID
                        </label>
                        <input
                          id="tenantId"
                          value={tenantId}
                          onChange={(event) => {
                            setTenantId(event.target.value);
                            setRequiredDocumentIds([]);
                          }}
                          maxLength={128}
                          required
                          className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-3 text-sm text-white outline-none focus:border-cyan-300/60"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="topK"
                          className="mb-2 block text-sm font-medium text-slate-300"
                        >
                          Top K
                        </label>
                        <input
                          id="topK"
                          type="number"
                          min={1}
                          max={100}
                          value={topK}
                          onChange={(event) =>
                            setTopK(Number(event.target.value))
                          }
                          required
                          className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-3 text-sm text-white outline-none focus:border-cyan-300/60"
                        />
                      </div>
                    </div>

                    <div className="grid gap-5 lg:grid-cols-2">
                      <div>
                        <h3 className="text-sm font-semibold text-emerald-200">
                          Required documents
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          At least one must appear within its allowed rank.
                          Only documents from the selected tenant are listed.
                        </p>
                        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-black/10 p-3">
                          {requiredDocuments.length === 0 ? (
                            <p className="text-sm text-slate-500">
                              No active documents belong to this tenant.
                            </p>
                          ) : (
                            requiredDocuments.map((document) => (
                              <label
                                key={document.id}
                                className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-white/[0.04]"
                              >
                                <input
                                  type="checkbox"
                                  checked={requiredDocumentIds.includes(document.id)}
                                  onChange={(event) =>
                                    toggleDocument(
                                      document.id,
                                      "required",
                                      event.target.checked
                                    )
                                  }
                                  className="mt-1 accent-emerald-400"
                                />
                                <span className="min-w-0">
                                  <span className="block text-sm text-slate-200">
                                    {document.title}
                                  </span>
                                  <span className="mt-1 block break-all text-xs text-slate-500">
                                    {document.id}
                                  </span>
                                </span>
                              </label>
                            ))
                          )}
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold text-rose-200">
                          Forbidden documents
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          None of these documents may appear. Cross-tenant
                          selections can explicitly test leakage.
                        </p>
                        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-black/10 p-3">
                          {catalog.documents.map((document) => (
                            <label
                              key={document.id}
                              className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-white/[0.04]"
                            >
                              <input
                                type="checkbox"
                                checked={forbiddenDocumentIds.includes(document.id)}
                                onChange={(event) =>
                                  toggleDocument(
                                    document.id,
                                    "forbidden",
                                    event.target.checked
                                  )
                                }
                                className="mt-1 accent-rose-400"
                              />
                              <span className="min-w-0">
                                <span className="block text-sm text-slate-200">
                                  {document.title}
                                </span>
                                <span className="mt-1 block break-all text-xs text-slate-500">
                                  {document.tenantId} · {document.id}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
                      <p className="text-xs text-slate-500">
                        {requiredDocumentIds.length} required ·{" "}
                        {forbiddenDocumentIds.length} forbidden
                      </p>
                      <button
                        type="submit"
                        disabled={saving || !suiteId}
                        className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving ? "Saving contract…" : "Save contract"}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Saved contracts
                    </h2>
                    <p className="mt-1 text-sm text-slate-400">
                      Enabled cases loaded from Appwrite.
                    </p>
                  </div>
                  <span className="text-sm text-slate-400">
                    {suiteCases.filter((testCase) => testCase.enabled).length} enabled
                  </span>
                </div>

                <div className="mt-5 space-y-3">
                  {suiteCases.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-slate-500">
                      No contracts are saved in this suite yet.
                    </p>
                  ) : (
                    suiteCases.map((testCase) => (
                      <article
                        key={testCase.id}
                        className="rounded-xl border border-white/10 bg-black/10 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <p className="max-w-3xl text-sm leading-6 text-slate-200">
                            {testCase.query}
                          </p>
                          <span
                            className={`rounded-full border px-2 py-1 text-xs ${
                              testCase.enabled
                                ? "border-emerald-400/20 text-emerald-300"
                                : "border-slate-500/30 text-slate-400"
                            }`}
                          >
                            {testCase.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-slate-400">
                            Tenant: {testCase.tenantId}
                          </span>
                          <span className="rounded-lg bg-emerald-400/[0.07] px-2.5 py-1.5 text-emerald-200">
                            {testCase.requiredCount} required
                          </span>
                          <span className="rounded-lg bg-rose-400/[0.07] px-2.5 py-1.5 text-rose-200">
                            {testCase.forbiddenCount} forbidden
                          </span>
                          <span className="rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-slate-400">
                            Top K: {testCase.topK}
                          </span>
                        </div>
                        <p className="mt-3 break-all text-xs text-slate-600">
                          {testCase.id}
                        </p>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </section>

            <aside className="space-y-6">
              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.035] p-5 sm:p-6">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                  Evaluation
                </div>
                <h2 className="mt-3 text-xl font-semibold text-white">
                  Run the saved suite
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  SiftGuard embeds each saved query, searches Qdrant with its
                  tenant filter, checks document expectations, and persists
                  run results and traces to Appwrite.
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <Metric
                    label="Enabled cases"
                    value={String(
                      suiteCases.filter((testCase) => testCase.enabled).length
                    )}
                  />
                  <Metric
                    label="Available docs"
                    value={String(catalog.documents.length)}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void handleEvaluate()}
                  disabled={evaluating || !suiteId}
                  className="mt-5 w-full rounded-xl bg-cyan-300 px-4 py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {evaluating ? "Evaluating saved contracts…" : "Evaluate selected suite"}
                </button>

                <p className="mt-3 text-xs leading-5 text-slate-500">
                  Failed contracts produce a non-passing evaluation run.
                  The demo fault-injection scenarios remain available in the
                  Regression Lab.
                </p>
              </div>

              {evaluation && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-white">
                      Evaluation report
                    </h2>
                    <StatusPill status={evaluation.status} />
                  </div>

                  <p className="mt-2 break-all text-xs text-slate-500">
                    Run ID: {evaluation.runId}
                  </p>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <Metric
                      label="Pass rate"
                      value={`${evaluation.passRate.toFixed(1)}%`}
                    />
                    <Metric
                      label="Duration"
                      value={`${(evaluation.durationMs / 1000).toFixed(1)}s`}
                    />
                    <Metric
                      label="Passed"
                      value={String(evaluation.passedCases)}
                    />
                    <Metric
                      label="Failed"
                      value={String(evaluation.failedCases)}
                    />
                  </div>

                  <div className="mt-5 space-y-3">
                    {evaluation.results.map((result) => (
                      <article
                        key={result.testCaseId}
                        className="rounded-xl border border-white/10 bg-black/10 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <p className="text-sm leading-6 text-slate-200">
                            {result.query}
                          </p>
                          <StatusPill status={result.status} />
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                          <div className="rounded-lg bg-white/[0.04] p-2">
                            <span className="block text-slate-500">Recall@K</span>
                            <span className="mt-1 block text-slate-200">
                              {result.recallAtK.toFixed(2)}
                            </span>
                          </div>
                          <div className="rounded-lg bg-white/[0.04] p-2">
                            <span className="block text-slate-500">MRR</span>
                            <span className="mt-1 block text-slate-200">
                              {result.reciprocalRank.toFixed(2)}
                            </span>
                          </div>
                          <div className="rounded-lg bg-white/[0.04] p-2">
                            <span className="block text-slate-500">Forbidden</span>
                            <span className="mt-1 block text-slate-200">
                              {result.forbiddenCount}
                            </span>
                          </div>
                        </div>

                        {result.failureSummary && (
                          <p className="mt-3 text-sm text-rose-200">
                            {result.failureCode}: {result.failureSummary}
                          </p>
                        )}

                        <div className="mt-4">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            Retrieved documents
                          </p>
                          {result.retrieved.length === 0 ? (
                            <p className="text-sm text-slate-500">
                              No documents returned.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {result.retrieved.map((document, index) => (
                                <div
                                  key={`${document.documentId}-${index}`}
                                  className="flex flex-wrap justify-between gap-2 rounded-lg border border-white/5 p-3 text-sm"
                                >
                                  <span className="text-slate-300">
                                    <span className="mr-2 text-slate-600">
                                      {index + 1}.
                                    </span>
                                    {document.title}
                                  </span>
                                  <span className="font-mono text-xs text-cyan-200">
                                    {document.score.toFixed(4)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <p className="mt-3 break-all text-xs text-slate-600">
                          Test case: {result.testCaseId}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-white/10 p-5">
                <h3 className="text-sm font-semibold text-white">
                  Evaluation contract
                </h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-400">
                  <li>• Required documents must meet the suite recall threshold.</li>
                  <li>• Required documents must respect any configured rank limit.</li>
                  <li>• Forbidden documents must not appear in results.</li>
                  <li>• Tenant filtering is applied by Qdrant on every search.</li>
                  <li>• Runs, metrics, failure codes and retrieval traces are persisted in Appwrite.</li>
                </ul>
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
