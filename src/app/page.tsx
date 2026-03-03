"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type PeopleHit = {
  id: string;
  title: string;
  url: string;
  snippet?: string;
  favicon?: string;
  image?: string;
  publishedDate?: string;
};

type SearchForm = {
  company: string;
  companyDomain: string;
  role: string;
  seniority: string;
  location: string;
  keywords: string;
  linkedinOnly: boolean;
  mode: "people" | "web";
  numResults: number;
};

const rolePresets: Array<{ label: string; value: string }> = [
  { label: "采购 / Procurement", value: "procurement purchasing buyer" },
  { label: "供应链 / Supply Chain", value: "supply chain sourcing" },
  { label: "产品经理 / PM", value: "product manager" },
  { label: "销售 / Sales", value: "sales business development" },
  { label: "运营 / Operations", value: "operations" },
];

const seniorityPresets: Array<{ label: string; value: string }> = [
  { label: "不限", value: "" },
  { label: "负责人", value: "head director vp" },
  { label: "经理", value: "manager lead" },
  { label: "专员", value: "specialist associate" },
];

function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function buildQuery(f: SearchForm) {
  const chunks: string[] = [];
  const company = f.company.trim();
  const domain = f.companyDomain.trim();
  const role = f.role.trim();
  const seniority = f.seniority.trim();
  const location = f.location.trim();
  const keywords = f.keywords.trim();

  if (role) chunks.push(role);
  if (seniority) chunks.push(seniority);
  if (company) chunks.push(`at ${company}`);
  if (domain) chunks.push(domain);
  if (location) chunks.push(location);
  if (keywords) chunks.push(keywords);

  return chunks.join(" ");
}

function toTsv(rows: PeopleHit[]) {
  const header = ["title", "url", "publishedDate"].join("\t");
  const body = rows
    .map((r) => [r.title, r.url, r.publishedDate ?? ""].join("\t"))
    .join("\n");
  return `${header}\n${body}\n`;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function hostnameFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export default function Home() {
  const [form, setForm] = useState<SearchForm>({
    company: "",
    companyDomain: "",
    role: "",
    seniority: "",
    location: "",
    keywords: "",
    linkedinOnly: true,
    mode: "people",
    numResults: 12,
  });

  const [hits, setHits] = useState<PeopleHit[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const query = useMemo(() => buildQuery(form), [form]);
  const selectedHits = useMemo(
    () => hits.filter((h) => selected[h.id]),
    [hits, selected],
  );

  useEffect(() => {
    const raw = localStorage.getItem("tradelens.form");
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as Partial<SearchForm>;
      setForm((s) => ({
        ...s,
        ...data,
        numResults: Math.max(
          3,
          Math.min(50, Number(data.numResults ?? s.numResults)),
        ),
        mode: data.mode === "web" ? "web" : "people",
        linkedinOnly: data.linkedinOnly !== false,
      }));
    } catch {
      localStorage.removeItem("tradelens.form");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("tradelens.form", JSON.stringify(form));
  }, [form]);

  async function runSearch() {
    const q = query.trim();
    if (!q) {
      setError("先把关键词写清楚：职位、公司、地区至少填一个。");
      setStatus("error");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError("");
    setStatus("loading");
    setSelected({});

    try {
      const res = await fetch("/api/people-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: q,
          mode: form.mode,
          numResults: form.numResults,
          linkedinOnly: form.linkedinOnly,
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

      const data = (await res.json()) as { results?: PeopleHit[]; error?: string };
      const list = data.results ?? [];
      setHits(list);
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
    for (const h of hits) m[h.id] = true;
    setSelected(m);
  }

  return (
    <div className="min-h-screen px-4 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(247,240,230,0.16)] bg-[rgba(6,19,26,0.55)] px-3 py-1 text-xs tracking-wide text-[rgba(247,240,230,0.86)] backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_0_4px_rgba(255,208,138,0.15)]" />
              TradeLens Dossier
            </div>
            <h1 className="mt-4 font-[family-name:var(--font-fraunces)] text-4xl leading-[1.05] tracking-tight text-[var(--paper)] sm:text-5xl">
              搜索外国公司职员（公开资料）
            </h1>
            <p className="mt-4 text-sm leading-6 text-[rgba(247,240,230,0.78)] sm:text-base">
              面向外贸：用“职位 + 公司 + 地区”组合出高命中查询，快速定位采购、供应链、销售等关键联系人。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/company-scout"
              className="rounded-full border border-[rgba(247,240,230,0.14)] bg-[rgba(6,19,26,0.55)] px-3 py-1 text-xs text-[rgba(247,240,230,0.84)] backdrop-blur transition hover:border-[rgba(148,242,255,0.5)] hover:text-[var(--paper)]"
            >
              公司 Scout
            </Link>
            {rolePresets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setForm((s) => ({ ...s, role: p.value }))}
                className="rounded-full border border-[rgba(247,240,230,0.14)] bg-[rgba(6,19,26,0.55)] px-3 py-1 text-xs text-[rgba(247,240,230,0.84)] backdrop-blur transition hover:border-[rgba(255,208,138,0.5)] hover:text-[var(--paper)]"
              >
                {p.label}
              </button>
            ))}
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
                  公司名称
                </label>
                <input
                  value={form.company}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, company: e.target.value }))
                  }
                  placeholder="例如：Decathlon / Bosch / IKEA"
                  className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm text-[var(--paper)] outline-none ring-0 placeholder:text-[rgba(247,240,230,0.45)] focus:border-[rgba(255,208,138,0.55)]"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-xs text-[rgba(247,240,230,0.72)]">
                  公司域名（可选）
                </label>
                <input
                  value={form.companyDomain}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, companyDomain: e.target.value }))
                  }
                  placeholder="例如：decathlon.com"
                  className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm text-[var(--paper)] outline-none placeholder:text-[rgba(247,240,230,0.45)] focus:border-[rgba(255,208,138,0.55)]"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-xs text-[rgba(247,240,230,0.72)]">
                  职位 / 角色关键词
                </label>
                <input
                  value={form.role}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, role: e.target.value }))
                  }
                  placeholder="例如：procurement manager / buyer / sourcing"
                  className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm text-[var(--paper)] outline-none placeholder:text-[rgba(247,240,230,0.45)] focus:border-[rgba(255,208,138,0.55)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <label className="text-xs text-[rgba(247,240,230,0.72)]">
                    级别
                  </label>
                  <select
                    value={form.seniority}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, seniority: e.target.value }))
                    }
                    className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-3 text-sm text-[var(--paper)] outline-none focus:border-[rgba(255,208,138,0.55)]"
                  >
                    {seniorityPresets.map((p) => (
                      <option key={p.label} value={p.value} className="bg-[#07161d]">
                        {p.label}
                      </option>
                    ))}
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
                          3,
                          Math.min(50, Number(e.target.value || 0)),
                        ),
                      }))
                    }
                    type="number"
                    min={3}
                    max={50}
                    className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm text-[var(--paper)] outline-none placeholder:text-[rgba(247,240,230,0.45)] focus:border-[rgba(255,208,138,0.55)]"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <label className="text-xs text-[rgba(247,240,230,0.72)]">
                  地区 / 国家（可选）
                </label>
                <input
                  value={form.location}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, location: e.target.value }))
                  }
                  placeholder="例如：Germany / UK / California"
                  className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm text-[var(--paper)] outline-none placeholder:text-[rgba(247,240,230,0.45)] focus:border-[rgba(255,208,138,0.55)]"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-xs text-[rgba(247,240,230,0.72)]">
                  额外关键词（可选）
                </label>
                <input
                  value={form.keywords}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, keywords: e.target.value }))
                  }
                  placeholder="例如：sportswear / OEM / import"
                  className="h-11 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm text-[var(--paper)] outline-none placeholder:text-[rgba(247,240,230,0.45)] focus:border-[rgba(255,208,138,0.55)]"
                />
              </div>

              <div className="mt-1 grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((s) => ({
                        ...s,
                        mode: s.mode === "people" ? "web" : "people",
                      }))
                    }
                    className={clsx(
                      "inline-flex h-10 items-center rounded-2xl border px-3 text-xs font-medium tracking-wide backdrop-blur transition",
                      form.mode === "people"
                        ? "border-[rgba(255,208,138,0.55)] bg-[rgba(255,208,138,0.12)] text-[var(--paper)]"
                        : "border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] text-[rgba(247,240,230,0.78)] hover:border-[rgba(255,208,138,0.35)]",
                    )}
                  >
                    {form.mode === "people" ? "People 模式" : "Web 模式"}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setForm((s) => ({ ...s, linkedinOnly: !s.linkedinOnly }))
                    }
                    className={clsx(
                      "inline-flex h-10 items-center rounded-2xl border px-3 text-xs font-medium tracking-wide backdrop-blur transition",
                      form.linkedinOnly
                        ? "border-[rgba(148,242,255,0.55)] bg-[rgba(148,242,255,0.10)] text-[var(--paper)]"
                        : "border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] text-[rgba(247,240,230,0.78)] hover:border-[rgba(148,242,255,0.35)]",
                    )}
                  >
                    仅 LinkedIn
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="submit"
                    disabled={status === "loading"}
                    className={clsx(
                      "group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-2xl border border-[rgba(255,208,138,0.55)] bg-[rgba(255,208,138,0.14)] px-4 text-sm font-medium tracking-wide text-[var(--paper)] transition focus:outline-none disabled:opacity-60",
                    )}
                  >
                    <span className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="absolute -left-20 top-[-40%] h-24 w-40 rotate-12 bg-[rgba(255,208,138,0.28)] blur-2xl" />
                      <span className="absolute -right-24 top-[40%] h-24 w-44 -rotate-12 bg-[rgba(148,242,255,0.20)] blur-2xl" />
                    </span>
                    <span className="relative">
                      {status === "loading" ? "搜索中…" : "开始搜索"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={cancelSearch}
                    disabled={status !== "loading"}
                    className="inline-flex h-12 items-center justify-center rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-4 text-sm font-medium tracking-wide text-[rgba(247,240,230,0.82)] transition hover:border-[rgba(148,242,255,0.35)] disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>

                {status === "error" && error ? (
                  <div className="rounded-2xl border border-[rgba(255,77,77,0.45)] bg-[rgba(255,77,77,0.10)] px-4 py-3 text-sm text-[rgba(255,232,232,0.92)]">
                    {error}
                  </div>
                ) : null}
              </div>
            </form>
          </section>

          <section className="rounded-3xl border border-[rgba(247,240,230,0.16)] bg-[rgba(6,19,26,0.55)] p-5 backdrop-blur sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium tracking-wide text-[rgba(247,240,230,0.9)]">
                  结果
                </h2>
                <div className="rounded-full border border-[rgba(247,240,230,0.12)] bg-[rgba(247,240,230,0.06)] px-3 py-1 text-xs text-[rgba(247,240,230,0.78)]">
                  {hits.length} 条
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleAll(true)}
                  disabled={!hits.length}
                  className="h-10 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-3 text-xs text-[rgba(247,240,230,0.8)] transition hover:border-[rgba(255,208,138,0.35)] disabled:opacity-50"
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={() => toggleAll(false)}
                  disabled={!hits.length}
                  className="h-10 rounded-2xl border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)] px-3 text-xs text-[rgba(247,240,230,0.8)] transition hover:border-[rgba(255,208,138,0.35)] disabled:opacity-50"
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const tsv = toTsv(selectedHits.length ? selectedHits : hits);
                    navigator.clipboard.writeText(tsv);
                  }}
                  disabled={!hits.length}
                  className="h-10 rounded-2xl border border-[rgba(148,242,255,0.55)] bg-[rgba(148,242,255,0.10)] px-3 text-xs text-[rgba(247,240,230,0.92)] transition hover:bg-[rgba(148,242,255,0.14)] disabled:opacity-50"
                >
                  复制表格
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const tsv = toTsv(selectedHits.length ? selectedHits : hits);
                    downloadText("people.tsv", tsv);
                  }}
                  disabled={!hits.length}
                  className="h-10 rounded-2xl border border-[rgba(255,208,138,0.55)] bg-[rgba(255,208,138,0.12)] px-3 text-xs text-[rgba(247,240,230,0.92)] transition hover:bg-[rgba(255,208,138,0.15)] disabled:opacity-50"
                >
                  下载 TSV
                </button>
              </div>
            </div>

            <div className="mt-5">
              {status === "idle" ? (
                <div className="rounded-3xl border border-[rgba(247,240,230,0.10)] bg-[rgba(247,240,230,0.05)] px-6 py-10">
                  <div className="max-w-xl">
                    <p className="text-sm text-[rgba(247,240,230,0.82)]">
                      试试这样写：
                    </p>
                    <div className="mt-3 grid gap-2 text-sm text-[rgba(247,240,230,0.78)]">
                      <div className="rounded-2xl border border-[rgba(247,240,230,0.12)] bg-[rgba(6,19,26,0.55)] px-4 py-3 font-mono text-xs">
                        procurement manager at Decathlon Germany
                      </div>
                      <div className="rounded-2xl border border-[rgba(247,240,230,0.12)] bg-[rgba(6,19,26,0.55)] px-4 py-3 font-mono text-xs">
                        buyer sourcing sportswear at IKEA Sweden
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {status === "loading" ? (
                <div className="grid gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-[86px] animate-pulse rounded-3xl border border-[rgba(247,240,230,0.12)] bg-[rgba(247,240,230,0.05)]"
                    />
                  ))}
                </div>
              ) : null}

              {status !== "loading" && hits.length ? (
                <div className="grid gap-3">
                  {hits.map((h) => {
                    const checked = !!selected[h.id];
                    return (
                      <article
                        key={h.id}
                        className="group relative overflow-hidden rounded-3xl border border-[rgba(247,240,230,0.12)] bg-[rgba(247,240,230,0.05)] px-4 py-4 transition hover:border-[rgba(255,208,138,0.26)]"
                      >
                        <div className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
                          <div className="absolute -left-16 top-[-40%] h-24 w-40 rotate-12 bg-[rgba(255,208,138,0.10)] blur-2xl" />
                          <div className="absolute -right-20 top-[48%] h-24 w-44 -rotate-12 bg-[rgba(148,242,255,0.08)] blur-2xl" />
                        </div>

                        <div className="relative flex gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setSelected((s) => ({ ...s, [h.id]: !checked }))
                            }
                            className={clsx(
                              "mt-1 h-5 w-5 flex-none rounded-md border transition",
                              checked
                                ? "border-[rgba(148,242,255,0.8)] bg-[rgba(148,242,255,0.22)]"
                                : "border-[rgba(247,240,230,0.22)] bg-[rgba(6,19,26,0.45)] hover:border-[rgba(255,208,138,0.42)]",
                            )}
                            aria-label="选择该条"
                          />

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-2">
                              {h.favicon ? (
                                <div
                                  className="mt-0.5 h-4 w-4 flex-none rounded-sm border border-[rgba(247,240,230,0.12)] bg-[rgba(247,240,230,0.06)] bg-contain bg-center bg-no-repeat opacity-90"
                                  style={{ backgroundImage: `url(${h.favicon})` }}
                                />
                              ) : (
                                <div className="mt-0.5 h-4 w-4 flex-none rounded-sm border border-[rgba(247,240,230,0.16)] bg-[rgba(247,240,230,0.06)]" />
                              )}
                              <a
                                href={h.url}
                                target="_blank"
                                rel="noreferrer"
                                className="line-clamp-2 text-sm font-medium leading-5 text-[rgba(247,240,230,0.92)] underline-offset-4 hover:underline"
                              >
                                {h.title}
                              </a>
                            </div>

                            {h.snippet ? (
                              <p className="mt-2 line-clamp-2 text-xs leading-5 text-[rgba(247,240,230,0.72)]">
                                {h.snippet}
                              </p>
                            ) : null}

                            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[rgba(247,240,230,0.66)]">
                              <span className="rounded-full border border-[rgba(247,240,230,0.12)] bg-[rgba(6,19,26,0.55)] px-2 py-0.5 font-mono">
                                {hostnameFromUrl(h.url)}
                              </span>
                              {h.publishedDate ? (
                                <span className="rounded-full border border-[rgba(247,240,230,0.12)] bg-[rgba(6,19,26,0.55)] px-2 py-0.5 font-mono">
                                  {new Date(h.publishedDate).toLocaleDateString()}
                                </span>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => navigator.clipboard.writeText(h.url)}
                                className="rounded-full border border-[rgba(247,240,230,0.12)] bg-[rgba(6,19,26,0.55)] px-2 py-0.5 transition hover:border-[rgba(255,208,138,0.35)]"
                              >
                                复制链接
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}

              {status === "done" && !hits.length ? (
                <div className="rounded-3xl border border-[rgba(247,240,230,0.10)] bg-[rgba(247,240,230,0.05)] px-6 py-10">
                  <p className="text-sm text-[rgba(247,240,230,0.82)]">
                    没找到结果。可以尝试：
                  </p>
                  <ul className="mt-3 grid gap-2 text-sm text-[rgba(247,240,230,0.72)]">
                    <li>把职位换成更常见的英文写法（buyer / sourcing / procurement）。</li>
                    <li>把公司域名留空，让搜索更宽。</li>
                    <li>关闭“仅 LinkedIn”，扩大来源。</li>
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
