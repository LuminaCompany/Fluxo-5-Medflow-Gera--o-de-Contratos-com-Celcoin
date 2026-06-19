# CLAUDE.md

This file guides Claude Code (claude.ai/code) when working in this repository.

## Project Overview

This is an **n8n automation project** for **Medflow** — a receivables-anticipation
platform for doctors, operated over WhatsApp with conversational AI. There is no
traditional codebase: **all logic lives inside n8n as workflow nodes.** This repo
holds reference material and the tooling config used to build those workflows.

**n8n instance:** `https://automacao-medflow-n8n.zhe0xi.easypanel.host`

**Primary workflow in this repo:** Fluxo 5 — Emissão CCB (Celcoin), ID `wqyQKymnaXLTFazA`.
The full product (6 flows) is specified in **`spec.md`** — read it before changing any
flow. This file is the *how you work*; `spec.md` is the *what the product is*.

## How You Build Workflows Here

All workflow changes are made through the **n8n-mcp** MCP server
(https://github.com/czlonkowski/n8n-mcp) — never by editing files locally. Workflow
construction is reinforced by the **n8n-skills** plugin
(https://github.com/czlonkowski/n8n-skills). Lean on both: the MCP tools give you
live node/template data and validation; the skills encode the patterns and gotchas.

### Recommended process (discovery → build → validate → deploy)

1. **Discover.** Check `search_templates` before building from scratch. Use
   `search_nodes` (in parallel for multiple candidates) and `get_node` to learn the
   exact properties. Choose detail level deliberately — minimal (~200 tokens) when you
   know the node, full (~3–8k tokens) when configuring something unfamiliar.
2. **Configure explicitly.** Never rely on default values — unset defaults cause
   runtime failures. Set every parameter the node needs.
3. **Validate in layers** *before* deploying: `validate_node` (minimal → full) on each
   configured node, then `validate_workflow` on the whole graph (this also runs AI Agent
   checks). Fix findings, then re-validate.
4. **Deploy and re-validate.** Apply with the management tools, then run
   `n8n_validate_workflow` and `n8n_autofix_workflow` to catch anything that slipped.

Run independent MCP calls in parallel. If you used a template, attribute it (author
name, username, n8n.io link).

### Key MCP tools

Core (no n8n API needed):
- `tools_documentation` — reference for any MCP tool. Call it when unsure of a tool's shape.
- `search_nodes` / `get_node` — find nodes and read their properties/docs.
- `validate_node` / `validate_workflow` — pre-deploy validation.
- `search_templates` / `get_template` — 2,300+ prebuilt workflows.

Management (require the n8n API to be configured):
- `mcp__n8n__n8n_get_workflow` — read current state.
- `mcp__n8n__n8n_update_partial_workflow` — make targeted changes (**preferred** over full update).
- `mcp__n8n__n8n_validate_workflow` — validate the live workflow after changes.
- `mcp__n8n__n8n_autofix_workflow` — fix common errors automatically.

> The n8n-mcp server and n8n-skills plugin must be configured before management tools
> work. n8n-skills install: `/plugin install czlonkowski/n8n-skills`. The MCP server is
> added via `.mcp.json` with `N8N_API_URL` + `N8N_API_KEY`. If these aren't connected
> yet, say so rather than guessing at workflow state.

### When to reach for which skill

The n8n-skills plugin covers, among others: **Expression Syntax** (`$json`, `$node`;
webhook data lives under `$json.body`), **MCP Tools Expert**, **Workflow Patterns**
(webhook / HTTP API / database / AI / scheduled), **Validation Expert** (reading errors,
false positives), **Node Configuration**, **Code JavaScript / Python / Code Tool**,
**Error Handling**, **Binary & Data**, **Sub-workflows**, **AI Agents**, **Multi-Instance**,
and **Self-Hosting**. Consult the matching skill before writing Code nodes, expressions,
or AI-agent wiring rather than improvising.

## Node Preferences & Conventions

- Use the **`n8n-nodes-base.supabase`** node (credential `PBRtbhImrvfXokbu`,
  "Supabase account 2") for **all** Supabase operations — never HTTP Request nodes for
  Supabase. Easier to read and edit in the n8n UI.
- HTTP Request nodes are only for external APIs (Celcoin, Evolution API, ClickSign, etc.).
- **Partial-update ordering gotcha:** with mixed operation types in one
  `n8n_update_partial_workflow` call, the tool may reorder them (e.g. `updateNode` before
  `removeConnection`), causing name-mismatch errors. Split into two calls:
  1. `removeNode` / `removeConnection` only
  2. `updateNode` (rename/code) + `addConnection`
- The validator rejects disconnected nodes — if removing a node orphans others, add the
  replacement connection in the same call.

## Project Context (see `spec.md` for full detail)

**Flows:** 1 Aviso → 2 Receptor/Roteador → 3 Agente Ana → 4A ClickSign (Termos) →
5 Emissão CCB Celcoin (`wqyQKymnaXLTFazA`) → 6 Assinatura/Finalização (`kr8Ou1tefMyzEDnB`).

**Credentials (n8n):**

| Service | Credential ID | Name |
|---------|--------------|------|
| Celcoin Basic Auth | `nUAcFOPzE1fWKMXU` | Auth Celcoin |
| Google Sheets | `KUzlSxm9Z7LCNAkR` | Google Sheets account |
| Supabase | `PBRtbhImrvfXokbu` | Supabase account 2 |

**Env vars (n8n):** `CELCOIN_PRODUCT_ID`, `CELCOIN_FUNDING_ID`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`.

**Data stores:** Google Sheets (ID `1A5rjuCrQaQN9Lhb6EqnLa1i0yfOCG_MdMHP6Nvp8Oc4`) is the
primary source of doctor/anticipation data; Supabase (project `ijankjcupfdfqhvulrfh`)
tracks `contracts_ccb`, `contracts_termos_servico`, `operation_logs`.

### Celcoin (FlowFinance) API — sandbox only

- Auth: `https://sandbox.auth.flowfinance.com.br/oauth2/token` — Basic Auth →
  `client_credentials` grant → Bearer token (~1h TTL).
- Platform: `https://sandbox.platform.flowfinance.com.br/banking/originator`.
- Key endpoints: `GET /persons` (no server-side phone filter — filter in code by
  `phone.area_code + phone.number`), `POST /applications/preview-total-amount` (simulate),
  `POST /applications` (create CCB; needs `product.id`, `borrower.id`, `funding.id`;
  `signature_collect_method: LINK`), `GET /applications/{id}/signatures` (returns
  `collect_sign_link`, a ZapSign URL).

### Data-flow rules (Fluxo 5)

- Phone enters as `5511999999999` (with country code 55). Celcoin stores
  `{ country_code, area_code, number }` — match by concatenating `area_code + number`.
- `Extrair Token` carries all data forward via `{ token, ...doctorData }`.
- `Extrair Person Celcoin` adds `person_id`; downstream nodes read
  `$('Extrair Person Celcoin').first().json` as `prevData`.

## Reference Files (do not modify)

- **`spec.md`** — full product spec: all 6 flows, Supabase schema, integrations, pending work.
- **`celcoin-medflow.yaml`** — Insomnia collection with all Celcoin endpoints, request
  bodies, and auth patterns.
- **`.firecrawl/`** — scraped ClickSign docs (auth, sandbox, IP allowlist, 403 fixes).
