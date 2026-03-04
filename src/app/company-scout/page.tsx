"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type CompanyRow = {
  id: string;
  name: string;
  website: string;
  domain: string;
  intro?: string;
  details?: string;
  emails: string[];
  sources: string[];
};

type FormState = {
  country: string;
  niche: string;
  features: string;
  companyType: string;
  languageHint: "auto" | "en" | "zh";
  mode: "company" | "web";
  numResults: number;
  enrichEmails: boolean;
  queryOverride: string;
};

function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function normalizeDomain(input: string) {
  const s = input.trim();
  if (!s) return "";
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return s.replace(/^www\./, "");
  }
}

function toTsv(rows: CompanyRow[]) {
  const header = ["name", "website", "emails", "intro", "details"].join("\t");
  const body = rows
    .map((r) => {
      const emails = r.emails.join(", ");
      const intro = (r.intro ?? "").replaceAll("\t", " ").replaceAll("\n", " ");
      const details = (r.details ?? "")
        .replaceAll("\t", " ")
        .replaceAll("\n", " ");
      return [r.name, r.website, emails, intro, details].join("\t");
    })
    .join("\n");
  return `${header}\n${body}\n`;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadXlsx(filename: string, rows: CompanyRow[]) {
  const XLSX = await import("xlsx");
  const aoa: Array<Array<string>> = [
    ["name", "website", "emails", "intro", "details", "sources"],
    ...rows.map((r) => [
      r.name ?? "",
      r.website ?? "",
      r.emails.join(", "),
      r.intro ?? "",
      r.details ?? "",
      r.sources.join(", "),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 28 },
    { wch: 34 },
    { wch: 28 },
    { wch: 52 },
    { wch: 64 },
    { wch: 48 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "companies");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    filename,
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}

function buildSuggestedQuery(f: FormState) {
  if (f.queryOverride.trim()) return f.queryOverride.trim();
  const country = f.country.trim();
  const niche = f.niche.trim();
  const features = f.features.trim();
  const companyType = f.companyType.trim();

  const parts: string[] = [];

  if (country) parts.push(country);
  if (niche) parts.push(niche);
  if (features) parts.push(features);
  if (companyType) parts.push(companyType);

  if (parts.length === 0) return "";

  const hint =
    f.languageHint === "en"
      ? "startup companies"
      : f.languageHint === "zh"
        ? "初创公司"
        : "startups";

  if (!companyType) parts.push(hint);

  return parts.join(" ");
}

export default function CompanyScoutPage() {
  const [form, setForm] = useState<FormState>({
    country: "Canada",
    niche: "imported biscuits cookies candy",
    features: "distributor wholesaler",
    companyType: "startup",
    languageHint: "en",
    mode: "company",
    numResults: 15,
    enrichEmails: false,
    queryOverride: "",
  });

  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const query = useMemo(() => buildSuggestedQuery(form), [form]);
  const selectedRows = useMemo(
    () => rows.filter((r) => selected[r.id]),
    [rows, selected],
  );

  useEffect(() => {
    const raw = localStorage.getItem("tradelens.companyScoutForm");
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as Partial<FormState>;
      setForm((s) => ({
        ...s,
        ...data,
        numResults: Math.max(5, Math.min(50, Number(data.numResults ?? s.numResults))),
        mode: data.mode === "web" ? "web" : "company",
        enrichEmails: data.enrichEmails !== false,
        languageHint:
          data.languageHint === "en" || data.languageHint === "zh"
            ? data.languageHint
            : "auto",
      }));
    } catch {
      localStorage.removeItem("tradelens.companyScoutForm");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("tradelens.companyScoutForm", JSON.stringify(form));
  }, [form]);

  async function runSearch() {
    const q = query.trim();
    if (!q) {
      setError("先写清楚：国家 + 领域 + 特点（至少填一个）。");
      setStatus("error");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError("");
    setStatus("loading");
    setRows([]);
    setSelected({});

    try {
      const res = await fetch("/api/company-scout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: q,
          mode: form.mode,
          numResults: form.numResults,
          enrichEmails: form.enrichEmails,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        const msg =
          data?.error?.trim() ||
          (await res.text().catch(() => "")).trim() ||
          `请求失败（${res.status}）`;
        throw new Error(msg);
      }

      const data = (await res.json().catch(() => null)) as
        | { results?: CompanyRow[] }
        | null;
      setRows(data?.results ?? []);
      setStatus("done");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "未知错误");
      setStatus("error");
    }
  }

  function cancelSearch() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus((s) => (s === "loading" ? "idle" : s));
  }

  function toggleAll(next: boolean) {
    if (!next) {
      setSelected({});
      return;
    }
    const m: Record<string, boolean> = {};
    for (const r of rows) m[r.id] = true;
    setSelected(m);
  }

  return (
    <div className="min-h-screen px-4 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(247,240,230,0.16)] bg-[rgba(6,19,26,0.55)] px-3 py-1 text-xs tracking-wide text-[rgba(247,240,230,0.86)] backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-2)] shadow-[0_0_0_4px_rgba(148,242,255,0.12)]" />
              Market Scout
            </div>
            <h1 className="mt-4 font-[family-name:var(--font-fraunces)] text-4xl leading-[1.05] tracking-tight text-[var(--paper)] sm:text-5xl">
              搜索一个国家的某个领域初创公司
            </h1>
            <p className="mt-4 text-sm leading-6 text-[rgba(247,240,230,0.78)] sm:text-base">
              目标数据：公司名称、详细信息、官网、官网邮箱、介绍（公开信息，尽力提取邮箱）。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="rounded-full border border-[rgba(247,240,230,0.14)] bg-[rgba(6,19,26,0.55)] px-3 py-1 text-xs text-[rgba(247,240,230,0.84)] backdrop-blur transition hover:border-[rgba(255,208,138,0.5)]"
            >
              员工搜索
            </Link>
          </div>
        </header>

        <div className="mt-10 grid gap-6 lg:grid-cols-[420px_1fr]">
          <section className="rounded-3xl border border-[rgba(247,240,230,0.16)] bg-[rgba(6,19,26,0.55)] p-5 backdrop-blur sm:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium tracking-wide text-[rgba(247,240,230,0.9)]">
                查询面板
              </h2>
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(247,240,230,0.12)] bg-[rgba(247,240,230,0.06)] px-3 py-1 text-xs text-[rgba(247,240,230,0.78)]">
                <span className="font-mono">Q</span>
                <span className="max-w-[240px] truncate">{query || "…"}</span>
              </div>
            </div>

            <form
              className="mt-5 grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                runSearch();
              }}
            >
              <div className="grid gap-2">
                <label className="text-xs text-[rgba(247,240,230,0.72)]">
                  国家 / 地区
                </label>
                <input
                  value={form.country}
                  onChange={(e) => setForm((s) => ({ ...s, country: e.target.value }))}
                  placeholder="例如：Canada / Germany / UAE"
                  className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm text-[var(--paper)] outline-none placeholder:text-[rgba(247,240,230,0.45)] focus:border-[rgba(148,242,255,0.55)]"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-xs text-[rgba(247,240,230,0.72)]">
                  领域（建议英文）
                </label>
                <input
                  value={form.niche}
                  onChange={(e) => setForm((s) => ({ ...s, niche: e.target.value }))}
                  placeholder="例如：imported biscuits cookies candy"
                  className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm text-[var(--paper)] outline-none placeholder:text-[rgba(247,240,230,0.45)] focus:border-[rgba(148,242,255,0.55)]"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-xs text-[rgba(247,240,230,0.72)]">
                  特点 / 标签（可选）
                </label>
                <input
                  value={form.features}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, features: e.target.value }))
                  }
                  placeholder="例如：distributor wholesaler DTC organic"
                  className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm text-[var(--paper)] outline-none placeholder:text-[rgba(247,240,230,0.45)] focus:border-[rgba(148,242,255,0.55)]"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-xs text-[rgba(247,240,230,0.72)]">
                  公司类型（可选）
                </label>
                <input
                  value={form.companyType}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, companyType: e.target.value }))
                  }
                  placeholder="例如：startup / early-stage / new brand"
                  className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm text-[var(--paper)] outline-none placeholder:text-[rgba(247,240,230,0.45)] focus:border-[rgba(148,242,255,0.55)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <label className="text-xs text-[rgba(247,240,230,0.72)]">
                    模式
                  </label>
                  <select
                    value={form.mode}
                    onChange={(e) =>
                      setForm((s) => ({
                        ...s,
                        mode: e.target.value === "web" ? "web" : "company",
                      }))
                    }
                    className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-3 text-sm text-[var(--paper)] outline-none focus:border-[rgba(148,242,255,0.55)]"
                  >
                    <option value="company" className="bg-[#07161d]">
                      Company
                    </option>
                    <option value="web" className="bg-[#07161d]">
                      Web
                    </option>
                  </select>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs text-[rgba(247,240,230,0.72)]">
                    结果数
                  </label>
                  <input
                    value={form.numResults}
                    onChange={(e) =>
                      setForm((s) => ({
                        ...s,
                        numResults: Math.max(
                          5,
                          Math.min(50, Number(e.target.value || 0)),
                        ),
                      }))
                    }
                    type="number"
                    min={5}
                    max={50}
                    className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm text-[var(--paper)] outline-none focus:border-[rgba(148,242,255,0.55)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <label className="text-xs text-[rgba(247,240,230,0.72)]">
                    语言提示
                  </label>
                  <select
                    value={form.languageHint}
                    onChange={(e) =>
                      setForm((s) => ({
                        ...s,
                        languageHint:
                          e.target.value === "en"
                            ? "en"
                            : e.target.value === "zh"
                              ? "zh"
                              : "auto",
                      }))
                    }
                    className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-3 text-sm text-[var(--paper)] outline-none focus:border-[rgba(148,242,255,0.55)]"
                  >
                    <option value="auto" className="bg-[#07161d]">
                      Auto
                    </option>
                    <option value="en" className="bg-[#07161d]">
                      English
                    </option>
                    <option value="zh" className="bg-[#07161d]">
                      中文
                    </option>
                  </select>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs text-[rgba(247,240,230,0.72)]">
                    邮箱提取
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((s) => ({ ...s, enrichEmails: !s.enrichEmails }))
                    }
                    className={clsx(
                      "h-11 rounded-2xl border px-3 text-sm transition",
                      form.enrichEmails
                        ? "border-[rgba(148,242,255,0.55)] bg-[rgba(148,242,255,0.10)] text-[rgba(247,240,230,0.92)]"
                        : "border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] text-[rgba(247,240,230,0.78)] hover:border-[rgba(148,242,255,0.35)]",
                    )}
                  >
                    {form.enrichEmails ? "开启" : "关闭"}
                  </button>
                </div>
              </div>

              <div className="grid gap-2">
                <label className="text-xs text-[rgba(247,240,230,0.72)]">
                  高级：直接写搜索词（覆盖上面的组合）
                </label>
                <textarea
                  value={form.queryOverride}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, queryOverride: e.target.value }))
                  }
                  placeholder="例如：Canada imported biscuits cookies candy distributor startup companies"
                  rows={3}
                  className="resize-none rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 py-3 text-sm text-[var(--paper)] outline-none placeholder:text-[rgba(247,240,230,0.45)] focus:border-[rgba(148,242,255,0.55)]"
                />
              </div>

              <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-2xl border border-[rgba(148,242,255,0.55)] bg-[rgba(148,242,255,0.10)] px-4 text-sm font-medium tracking-wide text-[var(--paper)] transition disabled:opacity-60"
                >
                  <span className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="absolute -left-20 top-[-40%] h-24 w-40 rotate-12 bg-[rgba(148,242,255,0.22)] blur-2xl" />
                    <span className="absolute -right-24 top-[40%] h-24 w-44 -rotate-12 bg-[rgba(255,208,138,0.16)] blur-2xl" />
                  </span>
                  <span className="relative">
                    {status === "loading" ? "搜索中…" : "开始搜索"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={cancelSearch}
                  disabled={status !== "loading"}
                  className="inline-flex h-12 items-center justify-center rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm font-medium tracking-wide text-[rgba(247,240,230,0.82)] transition hover:border-[rgba(255,208,138,0.35)] disabled:opacity-50"
                >
                  取消
                </button>
              </div>

              {status === "error" && error ? (
                <div className="rounded-2xl border border-[rgba(255,77,77,0.45)] bg-[rgba(255,77,77,0.10)] px-4 py-3 text-sm text-[rgba(255,232,232,0.92)]">
                  {error}
                </div>
              ) : null}
            </form>
          </section>

          <section className="rounded-3xl border border-[rgba(247,240,230,0.16)] bg-[rgba(6,19,26,0.55)] p-5 backdrop-blur sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium tracking-wide text-[rgba(247,240,230,0.9)]">
                  公司列表
                </h2>
                <div className="rounded-full border border-[rgba(247,240,230,0.12)] bg-[rgba(247,240,230,0.06)] px-3 py-1 text-xs text-[rgba(247,240,230,0.78)]">
                  {rows.length} 家
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleAll(true)}
                  disabled={!rows.length}
                  className="h-10 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-3 text-xs text-[rgba(247,240,230,0.8)] transition hover:border-[rgba(148,242,255,0.35)] disabled:opacity-50"
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={() => toggleAll(false)}
                  disabled={!rows.length}
                  className="h-10 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-3 text-xs text-[rgba(247,240,230,0.8)] transition hover:border-[rgba(148,242,255,0.35)] disabled:opacity-50"
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const tsv = toTsv(selectedRows.length ? selectedRows : rows);
                    navigator.clipboard.writeText(tsv);
                  }}
                  disabled={!rows.length}
                  className="h-10 rounded-2xl border border-[rgba(148,242,255,0.55)] bg-[rgba(148,242,255,0.10)] px-3 text-xs text-[rgba(247,240,230,0.92)] transition hover:bg-[rgba(148,242,255,0.14)] disabled:opacity-50"
                >
                  复制表格
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const list = selectedRows.length ? selectedRows : rows;
                    await downloadXlsx("companies.xlsx", list);
                  }}
                  disabled={!rows.length}
                  className="h-10 rounded-2xl border border-[rgba(255,208,138,0.55)] bg-[rgba(255,208,138,0.12)] px-3 text-xs text-[rgba(247,240,230,0.92)] transition hover:bg-[rgba(255,208,138,0.15)] disabled:opacity-50"
                >
                  下载 XLSX
                </button>
              </div>
            </div>

            <div className="mt-5">
              {status === "idle" ? (
                <div className="rounded-3xl border border-[rgba(247,240,230,0.10)] bg-[rgba(247,240,230,0.05)] px-6 py-10">
                  <p className="text-sm text-[rgba(247,240,230,0.82)]">
                    示例（你提到的场景）：
                  </p>
                  <div className="mt-3 grid gap-2">
                    <div className="rounded-2xl border border-[rgba(247,240,230,0.12)] bg-[rgba(6,19,26,0.55)] px-4 py-3 font-mono text-xs text-[rgba(247,240,230,0.86)]">
                      Canada imported biscuits cookies candy distributor startup companies
                    </div>
                    <div className="text-xs leading-5 text-[rgba(247,240,230,0.68)]">
                      建议把“领域+特点”写成英文短语更容易命中；公司类型用 startup / new brand / early-stage。
                    </div>
                  </div>
                </div>
              ) : null}

              {status === "loading" ? (
                <div className="grid gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-[96px] animate-pulse rounded-3xl border border-[rgba(247,240,230,0.12)] bg-[rgba(247,240,230,0.05)]"
                    />
                  ))}
                </div>
              ) : null}

              {status !== "loading" && rows.length ? (
                <div className="grid gap-3">
                  {rows.map((r) => {
                    const checked = !!selected[r.id];
                    const domain = normalizeDomain(r.domain || r.website);
                    return (
                      <article
                        key={r.id}
                        className="group relative overflow-hidden rounded-3xl border border-[rgba(247,240,230,0.12)] bg-[rgba(247,240,230,0.05)] px-4 py-4 transition hover:border-[rgba(148,242,255,0.26)]"
                      >
                        <div className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
                          <div className="absolute -left-16 top-[-40%] h-24 w-40 rotate-12 bg-[rgba(148,242,255,0.10)] blur-2xl" />
                          <div className="absolute -right-20 top-[48%] h-24 w-44 -rotate-12 bg-[rgba(255,208,138,0.08)] blur-2xl" />
                        </div>

                        <div className="relative flex gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setSelected((s) => ({ ...s, [r.id]: !checked }))
                            }
                            className={clsx(
                              "mt-1 h-5 w-5 flex-none rounded-md border transition",
                              checked
                                ? "border-[rgba(148,242,255,0.8)] bg-[rgba(148,242,255,0.22)]"
                                : "border-[rgba(247,240,230,0.22)] bg-[rgba(6,19,26,0.45)] hover:border-[rgba(148,242,255,0.42)]",
                            )}
                            aria-label="选择该公司"
                          />

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-start gap-2">
                                  <a
                                    href={r.website}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="line-clamp-2 text-sm font-medium leading-5 text-[rgba(247,240,230,0.92)] underline-offset-4 hover:underline"
                                  >
                                    {r.name || r.website}
                                  </a>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[rgba(247,240,230,0.66)]">
                                  {domain ? (
                                    <span className="rounded-full border border-[rgba(247,240,230,0.12)] bg-[rgba(6,19,26,0.55)] px-2 py-0.5 font-mono">
                                      {domain}
                                    </span>
                                  ) : null}
                                  {r.emails.length ? (
                                    <span className="rounded-full border border-[rgba(148,242,255,0.22)] bg-[rgba(148,242,255,0.08)] px-2 py-0.5 font-mono text-[rgba(247,240,230,0.78)]">
                                      {r.emails.slice(0, 2).join(", ")}
                                    </span>
                                  ) : (
                                    <span className="rounded-full border border-[rgba(247,240,230,0.12)] bg-[rgba(6,19,26,0.55)] px-2 py-0.5 font-mono">
                                      未提取到邮箱
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => navigator.clipboard.writeText(r.website)}
                                    className="rounded-full border border-[rgba(247,240,230,0.12)] bg-[rgba(6,19,26,0.55)] px-2 py-0.5 transition hover:border-[rgba(255,208,138,0.35)]"
                                  >
                                    复制官网
                                  </button>
                                </div>
                              </div>

                              <div className="flex flex-col items-end gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    navigator.clipboard.writeText(
                                      r.emails.join(", ") || "",
                                    )
                                  }
                                  disabled={!r.emails.length}
                                  className="rounded-full border border-[rgba(247,240,230,0.12)] bg-[rgba(6,19,26,0.55)] px-2 py-0.5 text-[11px] text-[rgba(247,240,230,0.74)] transition hover:border-[rgba(148,242,255,0.35)] disabled:opacity-50"
                                >
                                  复制邮箱
                                </button>
                              </div>
                            </div>

                            {r.intro ? (
                              <p className="mt-3 line-clamp-2 text-xs leading-5 text-[rgba(247,240,230,0.72)]">
                                {r.intro}
                              </p>
                            ) : null}

                            {r.details ? (
                              <p className="mt-2 line-clamp-3 text-xs leading-5 text-[rgba(247,240,230,0.66)]">
                                {r.details}
                              </p>
                            ) : null}

                            {r.sources.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {r.sources.slice(0, 3).map((u) => (
                                  <a
                                    key={u}
                                    href={u}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-full border border-[rgba(247,240,230,0.12)] bg-[rgba(247,240,230,0.06)] px-2 py-0.5 text-[11px] text-[rgba(247,240,230,0.72)] transition hover:border-[rgba(255,208,138,0.28)]"
                                  >
                                    source
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}

              {status === "done" && !rows.length ? (
                <div className="rounded-3xl border border-[rgba(247,240,230,0.10)] bg-[rgba(247,240,230,0.05)] px-6 py-10">
                  <p className="text-sm text-[rgba(247,240,230,0.82)]">
                    没找到公司。可以尝试：
                  </p>
                  <ul className="mt-3 grid gap-2 text-sm text-[rgba(247,240,230,0.72)]">
                    <li>把领域关键词改成更通用英文（cookies / confectionery / snacks）。</li>
                    <li>去掉“startup”，先找公司再筛选。</li>
                    <li>把特点拆成 2-3 次搜索（分批更准）。</li>
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
