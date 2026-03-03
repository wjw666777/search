export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | {
        query?: string;
        mode?: "people" | "web";
        linkedinOnly?: boolean;
        numResults?: number;
      }
    | null;

  const query = body?.query?.trim() ?? "";
  const mode = body?.mode === "web" ? "web" : "people";
  const linkedinOnly = body?.linkedinOnly !== false;
  const numResults = Math.max(3, Math.min(50, Number(body?.numResults ?? 12)));

  if (!query) return Response.json({ error: "query 不能为空" }, { status: 400 });
  if (query.length > 320) {
    return Response.json(
      { error: "query 太长了（建议 ≤ 320 字符）" },
      { status: 400 },
    );
  }

  const apiKey = process.env.EXA_API_KEY ?? "";
  const url = process.env.EXA_API_URL ?? "https://api.exa.ai/search";

  if (!apiKey) {
    return Response.json(
      {
        error:
          "服务端缺少 EXA_API_KEY。请在 /search 下创建 .env.local 并写入 EXA_API_KEY=你的key",
      },
      { status: 500 },
    );
  }

  const payload: Record<string, unknown> = {
    query,
    numResults,
    type: "auto",
    contents: {
      text: { maxCharacters: 900 },
    },
  };

  if (mode === "people") {
    payload.category = "people";
    if (linkedinOnly) payload.includeDomains = ["linkedin.com"];
  }

  const res = await fetch(url, {
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
    return Response.json(
      { error: text || `Exa 请求失败（${res.status}）` },
      { status: 502 },
    );
  }

  const data = (await res.json().catch(() => null)) as
    | {
        results?: Array<{
          id?: string;
          title?: string;
          url?: string;
          publishedDate?: string;
          favicon?: string;
          image?: string;
          text?: string;
          summary?: string;
          highlights?: string[];
        }>;
      }
    | null;

  const normalized =
    data?.results
      ?.filter((r) => !!r?.url)
      .map((r) => {
        const snippet =
          r.text?.trim() ||
          r.summary?.trim() ||
          (Array.isArray(r.highlights) ? r.highlights[0] : "") ||
          "";
        return {
          id: r.id || r.url || `${Math.random()}`,
          title: r.title || r.url || "",
          url: r.url || "",
          favicon: r.favicon,
          image: r.image,
          publishedDate: r.publishedDate,
          snippet: snippet || undefined,
        };
      }) ?? [];

  return Response.json({ results: normalized });
}
