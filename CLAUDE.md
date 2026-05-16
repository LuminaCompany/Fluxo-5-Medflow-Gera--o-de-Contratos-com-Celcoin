# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **n8n automation workflow** project (not a traditional codebase). All logic lives inside n8n as workflow nodes. The only local file is `celcoin-medflow.yaml` — an Insomnia collection used as API reference for Celcoin/FlowFinance endpoints.

**Workflow:** Fluxo 5 — Emissão CCB (Celcoin)
**n8n Workflow ID:** `wqyQKymnaXLTFazA`
**n8n Instance:** `https://automacao-medflow-n8n.zhe0xi.easypanel.host`

## Working with This Project

All modifications are made via **n8n MCP tools** — not by editing files locally.

**Node preferences:**
- Use `n8n-nodes-base.supabase` (credential: `PBRtbhImrvfXokbu` "Supabase account 2") for ALL Supabase operations — never HTTP Request nodes for Supabase. Easier to read and edit in the UI.
- HTTP Request nodes are only for external APIs (Celcoin, Evolution API, etc.).

Key tools:
- `mcp__n8n__n8n_get_workflow` — read current state
- `mcp__n8n__n8n_update_partial_workflow` — make changes (preferred over full update)
- `mcp__n8n__n8n_validate_workflow` — validate after changes
- `mcp__n8n__n8n_autofix_workflow` — fix common errors

**Important MCP behavior:** When using `n8n_update_partial_workflow` with mixed operation types in one call, the tool may reorder them (e.g., `updateNode` before `removeConnection`). To avoid name-mismatch errors, split into separate calls:
1. First call: `removeNode` / `removeConnection` only
2. Second call: `updateNode` (rename/code) + `addConnection`

The workflow validator rejects disconnected nodes — if removing a node leaves others with no connections, add the replacement connection in the same call.

## Workflow Architecture

**Trigger:** Called by Fluxo 3 (WhatsApp flow) with `{ phone, instancia, mensagem }`.

**Flow sequence:**
```
Chamado pelo Fluxo 3
→ Preparar Busca          (clean phone: strip @s.whatsapp.net, keep digits only)
→ Buscar Médico Google Sheets  (lookup by phone column)
→ Médico Encontrado?      (IF: abort if not found)
→ Mapear Dados p/ Celcoin (map sheet columns → structured doctor object)
→ Autenticar Celcoin      (POST oauth2/token, Basic Auth)
→ Extrair Token           (merge token + doctor data into single object)
→ Buscar Pessoa Celcoin   (GET /persons — fetch all persons from Celcoin)
→ Extrair Person Celcoin  (find person_id by phone: area_code + number match)
→ Simular Empréstimo      (POST /applications/preview-total-amount)
→ Preparar Solicitação    (merge simulation result with doctor data)
→ Solicitar Empréstimo (CCB) (POST /applications)
→ Extrair Application ID  (extract application_id, carry forward key fields)
→ Adicionar Assinatura    (POST /applications/{id}/signatures — physical signature)
→ [parallel]
   ├── Enviar Contrato WhatsApp  (STUB — pendente implementação via WhatsApp API Oficial)
   ├── Salvar Contrato Supabase  (POST /rest/v1/contracts)
   └── Log Operação              (POST /rest/v1/operation_logs)
```

## Celcoin (FlowFinance) API

**Environment:** Sandbox only (prod URLs also point to sandbox currently)
- Auth: `https://sandbox.auth.flowfinance.com.br/oauth2/token`
- Platform: `https://sandbox.platform.flowfinance.com.br/banking/originator`
- Auth method: Basic Auth → `client_credentials` grant → Bearer token

**Credentials in n8n:** HTTP Basic Auth credential ID `nUAcFOPzE1fWKMXU` ("Auth Celcoin")

**Key endpoints:**
- `GET /persons` — list all persons (no server-side phone filter; filter in code by `phone.area_code + phone.number`)
- `POST /applications/preview-total-amount` — loan simulation
- `POST /applications` — create CCB (requires `product.id`, `borrower.id`, `funding.id`)
- `POST /applications/{id}/signatures` — add physical signature

**Product/Funding IDs** are stored as n8n env vars: `CELCOIN_PRODUCT_ID`, `CELCOIN_FUNDING_ID`.

## Data Flow Notes

- Phone format entering the workflow: `5511999999999` (full, with country code 55)
- Celcoin stores phone as `{ country_code, area_code, number }` — match by concatenating `area_code + number`
- `Extrair Token` node carries ALL data forward (token + all doctor fields) via `{ token, ...doctorData }`
- `Extrair Person Celcoin` adds `person_id` to that object — downstream nodes use `$('Extrair Person Celcoin').first().json` as `prevData`
- Google Sheets credential ID: `KUzlSxm9Z7LCNAkR` ("Google Sheets account"), sheet ID `1A5rjuCrQaQN9Lhb6EqnLa1i0yfOCG_MdMHP6Nvp8Oc4`

## Pending Implementation

- **Enviar Contrato WhatsApp**: stub Set node, outputs `{ status: "pendente_whatsapp", application_id, phone, nota }`. Will be replaced with WhatsApp API Oficial call when implemented.

## Reference File

`celcoin-medflow.yaml` — Insomnia collection with all Celcoin API endpoints. Use as reference for endpoint URLs, request body shapes, and auth patterns. Do not modify this file.
