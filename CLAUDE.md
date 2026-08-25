# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **n8n automation workflow** project (not a traditional codebase). All logic lives inside n8n as workflow nodes. The only local file is `Documentações da API/celcoin-medflow.yaml` — an Insomnia collection used as API reference for Celcoin/FlowFinance endpoints.

**n8n Instance:** `https://automacao-medflow-n8n.zhe0xi.easypanel.host`

| Workflow | ID |
|---|---|
| Fluxo 1 — Verificação e Disparo | `l6gvSDfxYZFibLG1` |
| Fluxo 2 — Buffer/Prosseguimento | `OwQhnPQB5MrjTWYz` |
| Fluxo 3 — Agente conversacional (Ana) | `FX6bv7g3sxAkjfhj` |
| Fluxo 4 — Contrato Termos (ClickSign) | `UBxeuuB9tt9Osfs3` |
| Fluxo 5 — Emissão CCB (Celcoin) | `wqyQKymnaXLTFazA` |
| Fluxo 6 — Sinal quando Assinado | `kr8Ou1tefMyzEDnB` |
| helper-medflow-consulta (tool do Fluxo 3) | `1CtjHDUJDsPvqL34` |

## Fonte primária de dados — API MedFlow

**Desde 2026-08-12 a API MedFlow é a base de dados primária de TODO o sistema**, não só dos Fluxos 4 e 5. A chave de acesso é o **CPF do médico**.

| Camada | Papel |
|---|---|
| **API MedFlow** | **Fonte da verdade**: cadastro do médico, plantões, valores, simulação, status das antecipações |
| Supabase | Identidade (FK `doctors.id`), cache do cadastro confirmado pela MedFlow, e estado dos contratos |
| Google Sheets | Máquina de estado legada (coluna `STATUS`), em saída — ver PENDENCIAS #P0-46 |
| Celcoin | Só a emissão da CCB e o `borrower.id` |

Nada de Google Sheets ou Supabase como fonte de valor de antecipação. Se um número aparece para o médico, ele veio da MedFlow naquele mesmo turno.

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

## Fluxo 3 — Agente conversacional (Ana)

**Trigger:** `When Executed by Another Workflow` — chamado pelo Fluxo 2 com `{ phone, instancia, mensagem }`.

**Identificação (desde 2026-08-12):** quem chega é o **telefone** (do Chatwoot). O **CPF é informado pelo médico na conversa** e é ele que vale como parâmetro de consulta; `doctors.cpf` é só rede de segurança quando o médico ainda não informou. O telefone nunca sai do canal — é ele que prova posse no `/service/token`.

```
When Executed by Another Workflow  ({ phone, instancia, mensagem })
→ Buscar Informações do medico   (Supabase doctors: whatsapp nos DOIS formatos, anyFilter)
→ Escolher Cadastro              (Code: desempata linhas duplicadas — prefere a que tem CPF)
→ Edit Fields                    (phone, user_message, doctor_* como fallback do 1o turno)
→ AI Agent — Ana Medflow1
     ├── Model:    OpenAI Chat (+ fallback)
     ├── Memory:   Postgres Chat Memory (sessionKey = phone, janela 20)
     └── Tool:     consultar_medflow  → helper-medflow-consulta
→ Refinar Mensagem IA            (Code: normaliza saída da IA e aplica os guards)
→ Switch por Intent1             (QUESTION | CONFIRMATION | TRANSFER_HUMAN | REJECTION | fallback)
```

### helper-medflow-consulta (`1CtjHDUJDsPvqL34`)

Tool única do agente. Autentica e consulta no mesmo passo, porque `/protected/*` **não aceita CPF como filtro** — devolve sempre o dono do token. Para o CPF digitado valer, ele precisa entrar no `POST /service/token`.

```
Fluxo Anterior ({ cpf, cpf_cadastro, phone, doctor_id, crm, crm_state })
→ Resolver CPF        (Code: informado > cadastro; valida DV; mascara p/ log; hash p/ cache;
                       normaliza telefone → phone_api (13 díg.) + phone_alt (legado))
→ Pode consultar?     ──false──► Montar Resposta (auth_error: cpf_ausente | cpf_invalido)
→ Buscar Token Cache  (Redis get medflow_token:<phone>:<hash do cpf>)
→ Tem token? ──true──► Definir Token
             └─false─► Autenticar MedFlow (phone_api) → Auth OK?
                          ├─true─► Auth Consolidada
                          └─false► Tentar phone alt? ─true─► Autenticar MedFlow Alt (phone_alt)
                                                     └false──────────────► Auth Consolidada
→ Auth Consolidada → Auth Final OK?
                          ├─false► Montar Resposta (401/404/409/429 → auth_error)
                          └─true─► Salvar Token Cache (TTL 840s)
                                 → Salvar Cadastro (Supabase por doctors.id: cpf/nome/email/crm confirmados)
                                 → Definir Token
→ Antecipacoes (GET /protected/receivables?dashboard=true)
→ Historico    (GET /protected/loans)
→ Montar Resposta
```

Saída única para a IA: `{ auth_ok, auth_error, required_fields, medico, antecipacoes[], historico[], operacao_em_curso }`. Já vem filtrado (sem `blocked`/sem `simulation`), somado, ordenado, cortado nos 3 loans mais recentes, e **nunca contém CPF**.

Invariantes que não podem ser quebradas ao mexer aqui:
- **O helper tem que ficar ativo/publicado.** Esta instância do n8n usa modelo draft/publish: sub-workflow despublicado faz a tool devolver `{"error":"Workflow is not active and cannot be executed."}` — a IA lê isso como falha e tentava transferir (72h de pausa). Aconteceu em 2026-08-24, execução `178747`.
- `phone` é expressão fixa do canal, **nunca `$fromAI`** — número digitado pelo contato não prova posse (o swagger é explícito).
- **O que vai para a API é `phone_api`, não o `phone` cru do canal** (ver "Telefone" na seção MedFlow API). O `phone` cru continua sendo a chave do Redis e o filtro de `doctors.whatsapp` — trocar isso quebra o cache e o `Salvar Cadastro`.
- Quem lê a autenticação é o node **`Auth Consolidada`**, nunca `Autenticar MedFlow` direto: em cada passagem só uma das duas tentativas executa.
- TTL do cache (840s) tem que ficar **abaixo** dos 900s do token, e o cache não pode ser regravado no caminho de cache-hit (resetaria o TTL e o cache sobreviveria ao token).
- `Salvar Cadastro` grava o que veio de `data.attributes` (confirmado pela MedFlow), nunca o texto cru digitado. **Filtra por `doctors.id`** (o `doctor_id` que o Fluxo 3 já desambiguou), nunca por `whatsapp`: filtrar por telefone pegava a linha duplicada sem CPF e batia na unique `doctors_cpf_key` (`duplicate key value violates unique constraint`).

## Fluxo 5 — Emissão CCB (Celcoin)

**Trigger:** `Fluxo Anterior` (executeWorkflowTrigger) — chamado pelo Fluxo 6 com `{ phone, cpf, instancia, plantao_id, plantao_ids }`.

**Flow sequence:**
```
Fluxo Anterior           ({ phone, cpf, instancia, plantao_id, plantao_ids })
→ Identidade Supabase    (doctors: anyFilter cpf|whatsapp — só p/ doctors.id (FK) e CPF de cadastro)
→ Resolver Identidade    (Code: cpf/phone só dígitos, input > Supabase; erra explícito se faltar)
→ Autenticar MedFlow     (POST /service/token, Basic client_id:secret + {cpf, phone_api})
→ Auth MedFlow OK?       ──false──► Autenticar MedFlow Alt (phone_alt) ─┐
→ Auth Consolidada       ◄──────────────────────────────────────────────┘
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

- `POST /service/token` — Basic `MEDFLOW_CLIENT_ID:MEDFLOW_CLIENT_SECRET` + body `{cpf, phone}`. **`cpf` é o único campo obrigatório**; `phone` é opcional mas é o que prova posse, e tem que ser o remetente real do canal — o swagger diz "NUNCA um número digitado pelo contato". Fallback oficial quando o telefone não bate: `crm` + `crm_state`. TTL 900s, `aud=chat-automation`.
  - **O 201 já devolve o cadastro completo** em `data.attributes`: `name, email, cpf, crm, crm_state, phone, birthdate, pix_key, pix_type, address{}`. Não é preciso chamar `/protected/profile` só para hidratar cadastro.
  - **Telefone: o formato tem que bater dígito a dígito com o cadastro.** O WhatsApp entrega celular BR no formato legado de 12 dígitos (`55` + DDD + 8, sem o nono dígito) e a MedFlow guarda 13 — `556198430401` devolve 401 e `5561998430401` devolve 201 para o mesmo médico (testado em 2026-08-24). CPF sozinho, sem telefone, **também** devolve 401: na prática o `phone` é obrigatório. Por isso os Code nodes de identidade produzem `phone_api` (normalizado, com o nono dígito) e `phone_alt` (forma legada), e todo fluxo tenta o alt antes de desistir. A resposta traz `verification_method: "phone"`.
  - Erros: `401 verification_failed` (CPF não bate com o telefone — a própria API barra CPF de terceiros), `404 user_not_found` (traz `meta.required_fields` com o que falta no cadastro), `409 identity_conflict`, `422` (CPF ausente/ inválido), `429` rate limit.
- `GET /protected/profile` — mesmos dados do `data.attributes` acima.
- `GET /protected/receivables?dashboard=true` — grupos de plantões. `data[].attributes.entries[]` tem `id` (UUID = `plantao_id`), `available_amount`, `simulation.{net_amount,interest,iof}`, `blocked`/`blocked_reason`.
- `GET /protected/loans` — histórico. O shape real é `data[].attributes.status` (o swagger diz `data[].status` — está errado).

Todo `/protected/*` exige **três** headers: `Authorization: Bearer <token>`, `JWT-AUD: chat-automation` e `Accept: application/json`. Sem o `Accept`, token inválido devolve HTML de login com HTTP 200 em vez de 401.

**Nenhum endpoint `/protected/*` aceita CPF como filtro** — todos devolvem o dono do token. Consulta com CPF só funciona emitindo um token novo com aquele CPF.

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

- **CPF é a chave de tudo.** Ordem de precedência em todo lugar: CPF informado pelo médico > `cpf` recebido do fluxo chamador > `doctors.cpf` do Supabase. Falta de CPF ou de telefone = erro explícito, não silêncio.
- Phone: sempre só dígitos com DDI (`5511999999999`); o `/service/token` recebe com `+` na frente e **com o nono dígito** (`phone_api`). O número cru do canal (12 dígitos) é o que casa com `doctors.whatsapp` e com as chaves de Redis — os dois formatos convivem de propósito.
- O Supabase (`doctors`) é usado para resolver identidade, obter a FK `doctors.id` dos inserts e **cachear o cadastro confirmado pela MedFlow** — nunca para valores de antecipação.
- **`doctors` tem linhas duplicadas do mesmo médico** por causa do formato do telefone: cadastro antigo gravado com 13 dígitos (`5561998430401`) e o canal criando outra linha com 12 (`556198430401`). O `Buscar Informações do medico` do Fluxo 3 procura os **dois** formatos (`anyFilter`) e o `Escolher Cadastro` fica com a linha que tem CPF (empate: a mais antiga, que carrega o histórico de contratos). Todo o resto do sistema usa o `doctors.id` que sai dali.
- Como `doctors.cpf` é preenchido: `helper-medflow-consulta` (a partir do CPF informado no chat, depois do 201) e `Upsert Doctor Supabase` do Fluxo 2 (a partir da coluna `CPF` da planilha).
- Celcoin devolve phone como `{ country_code, area_code, number }`; o Fluxo 5 já não depende disso (usa o phone da MedFlow).
- Google Sheets credential ID: `KUzlSxm9Z7LCNAkR` ("Google Sheets account"), sheet ID `1A5rjuCrQaQN9Lhb6EqnLa1i0yfOCG_MdMHP6Nvp8Oc4` — resta apenas como máquina de estado (coluna `STATUS`), não como fonte de dados.
- Env vars MedFlow: `MEDFLOW_CLIENT_ID`, `MEDFLOW_CLIENT_SECRET`.
- Credenciais além das já citadas: Redis `L9p3qKni4bM3kh1p` ("medflow"), Postgres `tN9OEmZXmhVeeMSf` ("Postgres Supabase"), Chatwoot header auth `RMOflFdlQ4t9V8t8` ("meta").

### Chaves de Redis em uso

| Chave | TTL | Quem grava |
|---|---|---|
| `pause:<phone>` | 72h (transfer) / 24h (reject) | Fluxo 3, saídas TRANSFER_HUMAN e REJECTION |
| `medflow_token:<phone>:<hash cpf>` | 840s | helper-medflow-consulta |

**Atenção:** `TRANSFER_HUMAN` no Fluxo 3 grava `pause:<phone>` por **72h** — o médico fica mudo para o bot três dias. Nunca transfira por falha de infra em conversa social; só quando a operação realmente não pode seguir.

### Guards do `Refinar Mensagem IA`

O node lê `$json.intermediateSteps` (o agente está com `returnIntermediateSteps: true`) e só considera a MedFlow viva se `consultar_medflow` devolveu `auth_ok: true` **naquele turno**. Regras que não podem ser afrouxadas:
- `CONFIRMATION` exige: tool consultada com sucesso + UUID válido + `doctor_id` + `confidence >= 0.6`.
- `CONFIRMATION` sem a tool ter sido chamada vira `QUESTION` (reconfirma), **não** `TRANSFER_HUMAN` — é erro da IA, e transferir custaria 72h de pausa ao médico.
- **`TRANSFER_HUMAN` vindo da IA com a MedFlow degradada é rebaixado para `QUESTION`** (guard `5a0`, desde 2026-08-24), a menos que o próprio médico tenha pedido atendente (regex `PEDIU_HUMANO` sobre a mensagem do turno). Roda **antes** de `5a`/`5b` de propósito: os portões abaixo criam `TRANSFER_HUMAN` legítimos (contrato que não pode ser emitido) e esses têm que sobreviver.
- Sem MedFlow no turno, nenhum valor em `R$` sai para o cliente (seria alucinação).
- Qualquer sequência de 11 dígitos na resposta é mascarada antes de enviar (anti-eco de CPF).

`consultaMedFlow()` desembrulha array (o n8n embrulha a saída do sub-workflow) e distingue duas degradações: `auth_error` de negócio (`verification_failed`, `user_not_found`, …) → pede o CPF de novo; `{error}` sem `auth_ok` nenhum (sub-workflow fora do ar) → `medflow_auth_error: 'tool_indisponivel'`.

Suíte local em `scratchpad/` (`refinar.js` + `test.js`, `resolver_cpf.js` + `montar_resposta.js` + `test_helper.js`, `phone.js` + `test_phone.js`): rodar `node test.js refinar.js`, `node test_helper.js` e `node test_phone.js` antes de subir qualquer mudança nesses Code nodes.

## Reference Files

- `Documentações da API/Celcoin/celcoin-medflow.yaml` — Insomnia collection com os endpoints Celcoin. Não modificar.
- Swagger MedFlow ao vivo: `https://app.medflowfin.com/api-docs/v1/swagger.yml` (extensão `.yml`). O host `medflow-hhrc.onrender.com` do Postman collection está morto.
- `Documentações/PENDENCIAS.md` — lista viva de pendências, numeração global (P0-1..P0-50, P1-*, P2-*, P3-*).
