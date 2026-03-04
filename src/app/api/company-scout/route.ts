type ExaResult = {
  id?: string;
  title?: string;
  url?: string;
  publishedDate?: string;
  favicon?: string;
  image?: string;
  text?: string;
  summary?: string;
  highlights?: string[];
};

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

function normalizeWebsite(url: string) {
  const raw = url.trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `https://${raw}`;
}

function pickSnippet(r: ExaResult) {
  const a = r.summary?.trim();
  if (a) return a;
  const b = r.text?.trim();
  if (b) return b;
  const c = Array.isArray(r.highlights) ? r.highlights[0]?.trim() : "";
  return c || "";
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function extractEmails(text: string) {
  const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const cleaned = found
    .map((e) => e.replace(/[),.;:]+$/g, "").trim())
    .filter((e) => e.length <= 120);
  return uniq(cleaned);
}

async function fetchWithTimeout(url: string, ms: number) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: c.signal,
      cache: "no-store",
      headers: {
        "user-agent": "TradeLensScout/1.0",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

async function exaSearch(
  apiUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
) {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Exa 请求失败（${res.status}）`);
  }

  const data = (await res.json().catch(() => null)) as
    | { results?: ExaResult[] }
    | null;
  return data?.results ?? [];
}

async function enrichEmailsForDomain(opts: {
  apiUrl: string;
  apiKey: string;
  domain: string;
  companyName: string;
}) {
  const domain = normalizeDomain(opts.domain);
  if (!domain) return [];

  const queries = [
    `contact email ${opts.companyName}`.trim(),
    `email ${domain}`.trim(),
    `contact us ${domain}`.trim(),
  ];

  for (const q of queries) {
    const results = await exaSearch(opts.apiUrl, opts.apiKey, {
      query: q,
      type: "auto",
      numResults: 3,
      includeDomains: [domain],
      contents: { text: { maxCharacters: 2500 } },
    });

    const text = results.map((r) => pickSnippet(r)).join("\n");
    const emails = extractEmails(text).filter((e) => e.includes("@"));
    if (emails.length) return emails.slice(0, 3);
  }

  const homepage = normalizeWebsite(domain);
  const html = await fetchWithTimeout(homepage, 2500);
  if (!html) return [];
  const emails = extractEmails(html);
  return emails.slice(0, 3);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }).map(
    async () => {
      while (cursor < items.length) {
        const i = cursor;
        cursor += 1;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | {
        query?: string;
        mode?: "company" | "web";
        numResults?: number;
        enrichEmails?: boolean;
      }
    | null;

  const query = body?.query?.trim() ?? "";
  const mode = body?.mode === "web" ? "web" : "company";
  const enrichEmails = body?.enrichEmails !== false;
  const numResults = Math.max(5, Math.min(50, Number(body?.numResults ?? 15)));

  if (!query) return Response.json({ error: "query 不能为空" }, { status: 400 });
  if (query.length > 320) {
    return Response.json(
      { error: "query 太长了（建议 ≤ 320 字符）" },
      { status: 400 },
    );
  }

  const apiKey = process.env.EXA_API_KEY ?? "";
  const apiUrl = process.env.EXA_API_URL ?? "https://api.exa.ai/search";

  if (!apiKey) {
    return Response.json(
      {
        error:
          "服务端缺少 EXA_API_KEY。请在 /search 下创建 .env.local 并写入 EXA_API_KEY=你的key",
      },
      { status: 500 },
    );
  }

  try {
    const payload: Record<string, unknown> = {
      query,
      type: "auto",
      numResults,
      contents: { text: { maxCharacters: 1400 } },
    };

    if (mode === "company") payload.category = "company";

    const results = await exaSearch(apiUrl, apiKey, payload);

    const baseRows = results
      .filter((r) => !!r?.url)
      .map((r) => {
        const website = normalizeWebsite(r.url || "");
        const domain = normalizeDomain(website);
        const snippet = pickSnippet(r);
        const name = (r.title || domain || website).trim();
        const id = (r.id || website || `${Math.random()}`).toString();
        return {
          id,
          name,
          website,
          domain,
          intro: snippet ? snippet.slice(0, 420) : undefined,
          details: snippet ? snippet.slice(0, 900) : undefined,
          emails: [] as string[],
          sources: uniq([website].filter(Boolean)),
        };
      });

    if (!enrichEmails) return Response.json({ results: baseRows });

    const isVercel = !!process.env.VERCEL;
    const maxEnrich = Math.min(isVercel ? 3 : 10, baseRows.length);
    const concurrency = isVercel ? 3 : 5;

    const enriched = await mapWithConcurrency(baseRows, concurrency, async (row, i) => {
      if (i >= maxEnrich) return row;
      const emails = await enrichEmailsForDomain({
        apiUrl,
        apiKey,
        domain: row.domain || row.website,
        companyName: row.name,
      });
      row.emails = uniq(emails).slice(0, 3);
      return row;
    });

    return Response.json({ results: enriched });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "未知错误";
    return Response.json({ error: msg }, { status: 502 });
  }
}
