# Sell to State — Data API Guide

> Long-form companion to the API reference. The reference itself (`docs.selltostate.com`) is rendered from [`openapi.json`](./openapi.json) via Scalar; this guide is the narrative + worked examples. Keep both in sync with the app routes (see [`README.md`](./README.md)).

The Sell to State Data API gives programmatic and **agent-native** access to normalized government procurement award data as JSON, CSV, and an MCP server. Country coverage expands over time. The current award count and country count are on [selltostate.com](https://selltostate.com). This guide does not freeze a count.

- **Base URL:** `https://app.selltostate.com`. Do not call `api.selltostate.com`. That host is not deployed.
- **Dashboard:** `https://app.selltostate.com`
- **Reference:** `https://docs.selltostate.com`

---

## 1. Concepts

| Concept | What it means |
|---|---|
| **Subject** | Who is calling, normalized to `user:<id>` (API key) or `client:<id>` (agent). All gating is per-subject. |
| **Entitlement** | Whether the subject has an active subscription this request. No entitlement → `402`. |
| **Plan caps** | Trial = 20 rows/page & export; paid = 5,000. v1 entitlement is all-or-nothing. |
| **Scopes** | `data:read`, `data:export`, `data:bulk`. An active subscription grants all three in v1. |

---

## 2. Authentication

### 2a. API key (humans / your backend)

1. Sign in at `app.selltostate.com`, subscribe (or start the trial).
2. **Account → API keys** → create. The key (`sts_` + 48 hex) is shown **once**; store it. Only its SHA-256 hash is kept, and you can revoke it anytime.
3. Send it as a header:

```bash
curl -s "https://app.selltostate.com/api/v1/awards?q=cloud&page_size=5" \
  -H "x-api-key: sts_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 2b. Machine client (autonomous agents)

Agents self-register — no human, no dashboard — via RFC 7591 Dynamic Client Registration:

```bash
curl -s -X POST https://app.selltostate.com/api/oidc/register \
  -H "content-type: application/json" \
  -d '{"client_name":"My Procurement Agent"}'
```

Response includes `client_id`, `client_secret`, and a `payment_link`. The client has **zero data scopes** until it subscribes. Then authenticate data calls with:

```
Authorization: Bearer client:<client_id>
```

> Full OAuth 2.1 (authorization-code + token endpoints, the `OAuth2` scheme in the spec) is on the roadmap. Today, present the issued `client_id` directly as `Bearer client:<client_id>`.

---

## 3. Subscriptions & the 402 paywall

Read the live price (public, no auth):

```bash
curl -s https://app.selltostate.com/api/v1/price
# { "unit_amount": 4900, "currency": "usd", "interval": "month", "formatted": "$49/mo", "live": true }
```

Until your subject is active, **every data call returns `402`**:

```jsonc
{
  "error": "payment_required",
  "message": "An active subscription is required to access award data.",
  "payment_link": "https://app.selltostate.com/checkout",   // humans open this
  "plan": "data-monthly",
  "machine_payment": {                                       // agents use this
    "endpoint": "https://app.selltostate.com/api/v1/pay",
    "method": "POST",
    "accepts": ["payment_method_token", "customer"],
    "scopes_granted": ["data:read", "data:export"]
  },
  "price": "$49/mo",
  "currency": "usd"
}
```

…plus a header carrying both paths:

```
WWW-Authenticate: Bearer realm="data", charge="…/checkout", charge_automated="…/api/v1/pay"
```

### Pay as a human
Open `payment_link` (hosted Stripe Checkout). Done in a browser.

### Pay as an agent (no browser)
POST a Stripe payment-method token you control:

```bash
curl -s -X POST https://app.selltostate.com/api/v1/pay \
  -H "Authorization: Bearer client:c_abc123" \
  -H "content-type: application/json" \
  -d '{"payment_method_token":"pm_1Pxxxx"}'
```

Success → `{ "status": "active", "scopes": ["data:read","data:export"], ... }` and your **next** data call returns `200`. A decline returns `402` again (retryable) with `decline_code` echoed.

---

## 4. Searching awards

`GET /api/v1/awards` — paginated, filterable, ordered by awarded amount (desc).

| Param | Type | Notes |
|---|---|---|
| `q` | string | Full-text on tender description |
| `agency` | string | Exact slug or partial display-name |
| `supplier` | string | Partial display-name |
| `category` | string | Exact category slug |
| `year` | int | Award year (YYYY) |
| `amount_min` | int | Min awarded amount (local currency) |
| `amount_max` | int | **MCP tools only today** — REST parity pending GA |
| `page` | int | default 1 |
| `page_size` | int | default 100; capped by plan (20 trial / 5,000 paid) |

```bash
curl -s "https://app.selltostate.com/api/v1/awards?agency=ministry-of-education&year=2024&page_size=20" \
  -H "x-api-key: sts_…"
```

```jsonc
{
  "rows": [
    {
      "tender_no": "MOE000ETT24300001",
      "supplier": "ACME Engineering Pte Ltd",
      "agency": "Ministry of Education",
      "category": "Construction & Renovation",
      "awarded_amt": 4820000,
      "published_at": "2024-06-01",
      "awarded_at": "2024-07-12",
      "description": "Addition and alteration works to school premises…"   // truncated to 240 chars
    }
  ],
  "total": 17825,
  "page": 1,
  "pageSize": 20,
  "export_cap": 5000
}
```

Amounts are in the award's **local currency**. The subscription price is USD.

### Export CSV

```bash
curl -s "https://app.selltostate.com/api/v1/awards.csv?supplier=ACME" \
  -H "x-api-key: sts_…" -o awards.csv
```

Columns: `tender_no,supplier,agency,category,awarded_amt,published_at,awarded_at,description`. Row count capped by plan.

---

## 5. Entity, search, list & whoami endpoints (0.4.0)

0.4.0 brings REST, MCP, and the official CLI to **full parity**. All of these live under `/api/v1` and sit behind the same machine paywall as `/awards`.

### 5a. Self-introspection — `GET /api/v1/whoami`

Verify auth + entitlement **before** doing (paid) work. A valid-but-unentitled key returns `200` with `active:false` (decide to pay), not `402`; a missing/invalid credential returns `401`.

```bash
curl -s https://app.selltostate.com/api/v1/whoami -H "x-api-key: sts_…"
# { "subject":"user:u_abc", "type":"user", "active":true, "plan":"data-monthly",
#   "scopes":["data:read","data:export","data:bulk"], "export_cap":5000 }
```

### 5b. Faceted search — `GET /api/v1/search`

Typesense-backed search over one `scope` (`tenders|buyers|suppliers|sectors`) returning `{hits, found, page, per_page, facets}`. Filters: `q, country, sector` (repeatable), `type, status, year_min/max, amount_min/max, page, per_page` (≤50). Uses the 300/min search budget.

```bash
curl -s "https://app.selltostate.com/api/v1/search?scope=tenders&q=cybersecurity&year_min=2023" \
  -H "x-api-key: sts_…"
```

### 5c. Entity detail & lists

| Endpoint | Returns |
|---|---|
| `GET /api/v1/buyers` · `GET /api/v1/buyers/{slug}` | Top buyers · buyer detail (summary, yearly trend, sectors, top suppliers; `?sup_page`) |
| `GET /api/v1/suppliers` · `GET /api/v1/suppliers/{slug}` | Top suppliers · supplier detail (`?buyer_page`) |
| `GET /api/v1/sectors` · `GET /api/v1/sectors/{slug}` | Sector taxonomy · sector detail (`?kind=buyers\|suppliers`, `?page`) |
| `GET /api/v1/tenders/{id}` | Single award by `award_id` **or** public tender page id + related awards |

Detail/partner tables are row-capped on trial keys (`table_cap` echoes the applied cap).

### 5d. Saved lists & searches (owner-scoped — **user `x-api-key` only**)

A saved list/search belongs to a real user, so these require a dashboard `x-api-key`; an OIDC client (`Bearer client:`) token gets `403`.

```bash
# create a list, add a tender, read it back
LID=$(curl -s -X POST https://app.selltostate.com/api/v1/lists \
  -H "x-api-key: sts_…" -H "content-type: application/json" \
  -d '{"name":"Cyber FY24"}' | jq -r .id)
curl -s -X POST "https://app.selltostate.com/api/v1/lists/$LID/items" \
  -H "x-api-key: sts_…" -H "content-type: application/json" \
  -d '{"tender_no":"MOE000ETT24300001"}'
curl -s "https://app.selltostate.com/api/v1/lists/$LID" -H "x-api-key: sts_…"
```

`saved-searches` mirror lists exactly: `GET/POST /api/v1/saved-searches`, `GET/PATCH/DELETE /api/v1/saved-searches/{id}` (`kind:"atlas"` normalizes the query to the unified-search shape).

---

## 6. Using the API from an AI agent (MCP)

This API **is** an MCP server at `POST /api/mcp` (JSON-RPC 2.0).

List tools (open, no auth):

```bash
curl -s -X POST https://app.selltostate.com/api/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Call a tool (gated — present a credential; un-entitled → JSON-RPC error code `402`):

```bash
curl -s -X POST https://app.selltostate.com/api/mcp \
  -H "Authorization: Bearer client:c_abc123" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"search","arguments":{"scope":"tenders","q":"cloud","year_min":2024}}}'
```

The catalog is **26 tools** at full REST parity (0.4.0) — see the `x-mcp-tools` extension on the OpenAPI document for the authoritative list (name · scope · REST endpoint · `requires_user_key`). Highlights:

| Tool | Scope | Mirrors | Notes |
|---|---|---|---|
| `whoami` | data:read | `/api/v1/whoami` | Ungated self-introspection |
| `search` | data:read | `/api/v1/search` | Faceted search (scope) |
| `search_awards` | data:read | `/api/v1/awards` | Legacy Postgres explorer |
| `get_buyer` (`get_buyer_detail` alias) | data:read | `/api/v1/buyers/{slug}` | Buyer detail |
| `get_supplier_detail` | data:read | `/api/v1/suppliers/{slug}` | Supplier detail |
| `get_sector` / `get_tender` | data:read | `/api/v1/sectors\|tenders/{…}` | Sector / award detail |
| `list_buyers` / `list_suppliers` / `list_sectors` | data:read | `/api/v1/{…}` | Top-N + taxonomy |
| `get_lists`, `create_list`, `add_to_list`, … | data:read | `/api/v1/lists*` | **`requires_user_key`** |
| `get_saved_searches`, `save_search`, … | data:read | `/api/v1/saved-searches*` | **`requires_user_key`** |
| `export` | data:export | `/api/v1/awards.csv` | CSV export |
| `pay` | billing:pay | `/api/v1/pay` | Autonomous unlock |

Owner-scoped tools called with an OIDC client token return a `requires_user_key` result (mirrors the REST `403`).

**Discovery:** `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server` (RFC 8414).

---

## 6b. The official CLI — `selltostate`

`@data-atlas/cli` ships the `selltostate` binary, a 1:1 wrapper over this REST surface.

```bash
npm i -g @data-atlas/cli
selltostate auth login                 # verifies via /whoami, stores x-api-key (~/.config/selltostate/config.json, 0600)
selltostate whoami                     # or:  STS_API_KEY=sts_… selltostate whoami
selltostate search "cybersecurity" --scope tenders --year-min 2023 --per-page 20
selltostate get buyer ministry-of-education
selltostate buyers --limit 25
selltostate lists create "Cyber FY24"  # lists/saved-searches require a user key
selltostate export --supplier ACME -o awards.csv
```

`--format table|json|csv` (default `table`; `--json` is shorthand). Exit codes: `0` ok · `1` error · `2` unauthorized (401) · `3` payment required (402) · `4` rate limited (429) · `64` usage. Full command map is the `x-cli` extension on the OpenAPI document.

---

## 7. Pagination, caps, rate limits, errors

- **Pagination:** `page` + `page_size`; responses echo `total`, `page`, `pageSize`.
- **Caps:** 20 rows (trial) / 5,000 (paid), enforced on both JSON and CSV.
- **Rate limits:** 120 data calls/min per credential (per IP for anonymous); 10 client registrations/hour/IP. Over → `429` + `Retry-After` (seconds).

| Status | Meaning |
|---|---|
| `200` | OK |
| `303` | CSV: not entitled / unauthenticated → redirect to `/checkout` or `/auth` |
| `401` | `/pay`: no machine credential presented |
| `402` | Payment required (data) or payment declined (`/pay`, retryable) |
| `429` | Rate limited |
| `400` | MCP: unknown JSON-RPC method |
| `403` | Owner-scoped (`lists`, `saved-searches`) called with an OIDC client token instead of a user `x-api-key` |
| `404` | Unknown id/slug, or a foreign owner-scoped id (never leaks existence) |

---

## 8. Worked examples

### Python (requests)

```python
import requests
H = {"x-api-key": "sts_…"}
r = requests.get("https://app.selltostate.com/api/v1/awards",
                 params={"q": "cybersecurity", "year": 2024, "page_size": 50}, headers=H)
if r.status_code == 402:
    print("subscribe:", r.json()["payment_link"]); raise SystemExit
for row in r.json()["rows"]:
    print(row["published_at"], row["awarded_at"], row["awarded_amt"], row["agency"], "→", row["supplier"])
```

### Node (fetch)

```js
const res = await fetch("https://app.selltostate.com/api/v1/awards?supplier=ACME", {
  headers: { "x-api-key": process.env.STS_API_KEY },
});
if (res.status === 402) { console.log("subscribe:", (await res.json()).payment_link); }
else { const { rows, total } = await res.json(); console.log(total, "awards"); }
```

---

## 9. Changelog

- **0.4.0** — REST · MCP · CLI **parity**. New REST: `whoami`, faceted `search`, entity detail + lists (`buyers`, `suppliers`, `sectors`, `tenders/{id}`), saved **lists** and **saved-searches** CRUD (owner-scoped, user-key only). MCP catalog grows to **26 tools** (each mirrors a REST endpoint; `get_buyer` canonical with `get_buyer_detail` alias; owner-scoped tools gate on `requires_user_key`). Ships the official **`@data-atlas/cli`** (`selltostate` binary) at 1:1 command parity.
- **0.2.0** — Agent-native payments (`POST /api/v1/pay`), DCR (`/api/oidc/register`), MCP server (`/api/mcp`), live USD pricing, per-subject entitlement + 402 paywall, rate limiting.

## 10. Support

[support@selltostate.com](mailto:support@selltostate.com) · [selltostate.com](https://selltostate.com)
