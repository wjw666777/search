Tools for trade reps: find (1) people at a target company and (2) startups in a country + niche, powered by Exa. Export results as TSV for outreach workflows.

## Features

- People Search (`/`)
- Query builder: company, domain, role keywords, location, seniority, extra keywords
- Modes: People (profile-focused) / Web (broader pages)
- LinkedIn-only toggle (People mode): restrict to linkedin.com results
- Results: select, copy TSV, download TSV
- Local form persistence

- Company Scout (`/company-scout`)
- Query builder: country + niche + features + “startup” intent
- Output fields: name, website, extracted emails (best effort), intro/details, sources
- Results: select, copy TSV, download TSV

## Setup
Create `.env.local` in this folder:

```bash
EXA_API_KEY=your_exa_api_key
```

Optional:

```bash
EXA_API_URL=https://api.exa.ai/search
```

Notes:
- The API key is used server-side only (not exposed to the browser).
- If you already use Exa MCP, you can reuse the same API key here.

## Run locally

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000

## Key files

- People UI: [page.tsx](src/app/page.tsx)
- People API: [route.ts](src/app/api/people-search/route.ts)
- Company Scout UI: [page.tsx](src/app/company-scout/page.tsx)
- Company Scout API: [route.ts](src/app/api/company-scout/route.ts)

## Query tips

- Procurement: `procurement manager buyer sourcing at {Company} {Country}`
- Supply chain: `supply chain sourcing at {Company} {Region}`
- Import-related: `import manager purchasing at {Company}`

## Compliance

Use this for public information only. Follow target sites’ terms and local laws; avoid harassment or abuse.
