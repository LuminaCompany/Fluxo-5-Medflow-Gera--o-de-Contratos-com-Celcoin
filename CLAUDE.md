# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **n8n automation workflow** project (not a traditional codebase). All logic lives inside n8n as workflow nodes. The only local file is `Documentações da API/celcoin-medflow.yaml` — an Insomnia collection used as API reference for Celcoin/FlowFinance endpoints.
.
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

**Trigger:** `Fluxo Anterior` (executeWorkflowTrigger) — chamado pelo Fluxo 6 com `{ phone, cpf, instancia, plantao_id, plantao_ids }`.

**Regra de ouro (desde 2026-08-10):** toda informação de negócio — dados do médico e valores da antecipação — vem da **API MedFlow**, tendo o **CPF do médico como chave**. A Celcoin é usada só para emitir a CCB. Nada de Google Sheets como fonte de dados. O mesmo vale para o Fluxo 4.

**Flow sequence:**
```
Fluxo Anterior           ({ phone, cpf, instancia, plantao_id, plantao_ids })
→ Identidade Supabase    (doctors: anyFilter cpf|whatsapp — só p/ doctors.id (FK) e CPF de cadastro)
→ Resolver Identidade    (Code: cpf/phone só dígitos, input > Supabase; erra explícito se faltar)
→ Autenticar MedFlow     (POST /service/token, Basic client_id:secret + {cpf, phone})
→ Perfil MedFlow         (GET /protected/profile — nome, email, CRM, nascimento, endereço)
→ Médico Encontrado na tabela?  (IF: access_token && data.attributes) ──false──► Stop and Error
→ Antecipações MedFlow   (GET /protected/receivables?dashboard=true)
→ Somar CCB              (Code: casa plantao_ids ↔ entries[].id, aborta se blocked/ausente, soma)
→ Autenticação           (Celcoin POST oauth2/token)
→ Buscar medico pelo CPF (Celcoin GET /persons?taxpayer_id — ÚNICO dado Celcoin: borrower.id)
→ Medico Encontrado?     (IF) ──false──► Stop and Error
→ Preparar Solicitação   (MedFlow = médico + valor; Celcoin = person_id)
→ Solicitar Empréstimo (CCB)  (POST /applications)
→ Extrair Application ID
→ Aguardar Rendering (Wait 30s)
→ Buscar Link Assinatura (GET /applications/{id})
→ Buscar Assinaturas     (GET /applications/{id}/signatures → collect_sign_link)
→ Atualizar Status (CCB Enviado)  (Google Sheets — state machine, ver PENDENCIAS #P0-46)
→ [parallel]
   ├── Buscar medico Supabase → Salvar Contrato Supabase (contracts_ccb)
   ├── meta enviar texto        (WhatsApp: link de assinatura)
   └── Log Operação             (operation_logs)
```

## MedFlow API

Base `https://app.medflowfin.com/api/v1`, swagger em `/api-docs/v1/swagger.yml`.

- `POST /service/token` — Basic `MEDFLOW_CLIENT_ID:MEDFLOW_CLIENT_SECRET` + body `{cpf, phone}`. `phone` tem que ser o remetente real do canal (é ele que prova posse); o CPF só diz qual cadastro procurar. TTL 900s, `aud=chat-automation`.
- `GET /protected/profile` — dados pessoais do médico (name, email, cpf, crm, crm_state, birthdate, address{street,number,complement,neighborhood,city,state,postal_code}).
- `GET /protected/receivables?dashboard=true` — grupos de plantões. `data[].attributes.entries[]` tem `id` (UUID = `plantao_id`), `available_amount`, `simulation.{net_amount,interest,iof}`, `blocked`/`blocked_reason`.

Todo `/protected/*` exige **três** headers: `Authorization: Bearer <token>`, `JWT-AUD: chat-automation` e `Accept: application/json`. Sem o `Accept`, token inválido devolve HTML de login com HTTP 200 em vez de 401.

## Celcoin (FlowFinance) API

**Environment:** Sandbox only (prod URLs also point to sandbox currently)
- Auth: `https://sandbox.auth.flowfinance.com.br/oauth2/token`
- Platform: `https://sandbox.platform.flowfinance.com.br/banking/originator`
- Auth method: Basic Auth → `client_credentials` grant → Bearer token

**Credentials in n8n:** HTTP Basic Auth credential ID `nUAcFOPzE1fWKMXU` ("Auth Celcoin")

**Key endpoints em uso:**
- `GET /persons?taxpayer_id=<cpf>` — busca a pessoa pelo CPF. Serve **só** para obter o `borrower.id`; nenhum dado cadastral do médico é lido daqui (isso vem da MedFlow).
- `POST /applications` — cria a CCB (requer `product.id`, `borrower.id`, `funding.id`)
- `GET /applications/{id}` e `GET /applications/{id}/signatures` — link de assinatura (`collect_sign_link`)

**Product/Funding IDs** hoje estão hardcoded no `Solicitar Empréstimo (CCB)`; a spec pede env vars `CELCOIN_PRODUCT_ID` / `CELCOIN_FUNDING_ID` (PENDENCIAS #P0-2).

## Data Flow Notes

- **CPF é a chave de tudo.** `Resolver Identidade` normaliza para só dígitos, preferindo o `cpf` recebido do fluxo chamador e caindo no `doctors.cpf` do Supabase. Falta de CPF ou de telefone = erro explícito, não silêncio.
- Phone: sempre normalizado para só dígitos com DDI (`5511999999999`); o `/service/token` recebe com `+` na frente.
- O Supabase (`doctors`) é usado **apenas** para resolver identidade e obter a FK `doctors.id` dos inserts — nunca para valores.
- Celcoin devolve phone como `{ country_code, area_code, number }`; o Fluxo 5 já não depende disso (usa o phone da MedFlow).
- Google Sheets credential ID: `KUzlSxm9Z7LCNAkR` ("Google Sheets account"), sheet ID `1A5rjuCrQaQN9Lhb6EqnLa1i0yfOCG_MdMHP6Nvp8Oc4` — resta apenas como máquina de estado (coluna `STATUS`), não como fonte de dados.
- Env vars MedFlow: `MEDFLOW_CLIENT_ID`, `MEDFLOW_CLIENT_SECRET`.

## Reference Files

- `Documentações da API/Celcoin/celcoin-medflow.yaml` — Insomnia collection com os endpoints Celcoin. Não modificar.
- Swagger MedFlow ao vivo: `https://app.medflowfin.com/api-docs/v1/swagger.yml` (extensão `.yml`). O host `medflow-hhrc.onrender.com` do Postman collection está morto.
- `Documentações/PENDENCIAS.md` — lista viva de pendências, numeração global (P0-1..P0-50, P1-*, P2-*, P3-*).
