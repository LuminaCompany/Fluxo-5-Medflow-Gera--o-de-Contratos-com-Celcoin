# Medflow — Especificação do Produto

## Clarifications

### Session 2026-05-24

- Q: Onde persistir estado de rejeição do médico no Supabase? → A: Tabela `doctors_rejections` com FK `doctor_id` → tabela `doctors`
- Q: Quando reenviar oferta após REJECTION? → A: Reenvio acionado manualmente por enquanto (sem agendamento automático no MVP)
- Q: Após quantas rejeições parar de oferecer permanentemente? → A: Sem limite — sempre reenvia (sem blacklist automático)
- Q: O que executar imediatamente quando switch detecta REJECTION? → A: Mensagem de despedida cordial + upsert em `doctors_rejections` + grava `operation_logs` + encerra atendimento
- Q: Schema da tabela `doctors_rejections`? → A: `doctor_id` (FK), `phone`, `status`, `rejection_count`, `last_rejected_at`, `rejection_reason`, `rejection_history jsonb`

## Visão Geral

Medflow é uma plataforma de **antecipação de recebíveis para médicos**, operada via WhatsApp com IA conversacional. O médico recebe um aviso, confirma pelo WhatsApp, assina dois contratos digitais e recebe o valor antecipado, ainda não sabemos como.

**Stack principal:** n8n · Celcoin/FlowFinance · ClickSign · Evolution API / WhatsApp Cloud API (Meta) · OpenAI · Supabase · Google Sheets · Google Drive · Google Docs · Redis · PostgreSQL · Insomnia

**n8n instance:** `https://automacao-medflow-n8n.zhe0xi.easypanel.host`

---

## Jornada do Médico (macro)

```
Médico recebe aviso no WhatsApp (Fluxo 1)
  ↓
Médico responde no WhatsApp (Webhook Meta → Fluxo 2 → Fluxo 3)
  ↓
IA Ana classifica intenção:
  - CONFIRMATION → Fluxo 4 (Termos ClickSign)
  - REJECTION → mensagem de despedida (sub-fluxo pendente)
  - TRANSFER → atendimento humano (Redis)
  - QUESTION → resposta + continua conversa
  ↓
Médico assina Termos de Serviço (ClickSign)
  ↓
Webhook ClickSign → Fluxo 6 Ramo A → aciona Fluxo 5
  ↓
CCB emitida na Celcoin + link ZapSign enviado (Fluxo 5)
  ↓
Médico assina CCB
  ↓
Webhook Celcoin → Fluxo 6 Ramo B → finaliza operação
```

---

## Fluxos

### Fluxo 1 — Verificação e Disparo

**Workflow ID:** `l6gvSDfxYZFibLG1`
**Trigger:** Cron diário às 8h (Schedule Trigger)
**Responsabilidade:** Notificar médicos elegíveis com valor disponível para antecipação.

**Sequência real (11 nodes):**
```
Cron Diário 8h
→ Ler Google Sheets             (planilha de antecipações)
→ Filtrar Aprovados             (filter node: regras de elegibilidade)
→ Preparar Dados                (code: monta payload do médico)
→ Verificar Medicos             (code: checa estado no Supabase)
→ Atualizar Ou inserir Medicos  (code: upsert em doctors)
→ meta enviar texto             (HTTP Request — WhatsApp Cloud API/Meta)
→ Envio OK?                     (IF: avalia resposta da API)
   ├── true  → Log Sucesso Envio  (HTTP → operation_logs)
   └── false → Log Erro Envio     (HTTP → operation_logs)
→ Resumo Final                  (set: consolida output do ciclo)
```

**Observações:**
- Envio via **WhatsApp Cloud API oficial (Meta)** — não via Evolution API.
- Upsert do médico no Supabase é feito antes do envio (garante existência do registro para FK em `contracts_*` / `operation_logs`).

---

### Fluxo 2 — Receptor de Mensagens

**Workflow ID:** `OwQhnPQB5MrjTWYz`
**Trigger:** Webhook Meta (WhatsApp Cloud API) — `meta1`
**Responsabilidade:** Filtrar mensagens recebidas, registrar médico no Supabase e encaminhar ao Fluxo 3.

**Sequência real (caminho ativo):**
```
meta1 (Webhook Meta)
→ If                            (descarta eventos não relevantes — status updates, etc.)
→ é mensagem?                   (IF: verifica se payload contém mensagem de texto)
   ├── true  → Informações Medico Celcoin (set: monta objeto do médico)
   │       → Upsert Doctor Supabase       (HTTP Request: upsert em doctors)
   │       → Edit Fields1                 (set: prepara { phone, instancia, mensagem })
   │       → Call 'Fluxo 3 - Agente conversacional' (executeWorkflow)
   └── false → No Operation, do nothing
```

**Nodes desabilitados / legacy:**
- `Webhook`, `meta`, `Respond to Webhook` — endpoints antigos.
- `Call 'generic-buffer'1` — buffer de debounce desabilitado.
- `Apagador de Memoria` / `memoria*` — utilitários manuais para limpar contexto Postgres (acionados via Manual Trigger `.`).

**Observação:** o buffer de 10s descrito em versões anteriores **não está ativo**. Mensagens entram direto no Fluxo 3 após upsert do médico. Verificação de atendimento humano (Redis) também não está nesse fluxo — só é gravada pelo Fluxo 3 (TRANSFER).

---

### Fluxo 3 — Agente Conversacional (Ana)

**Workflow ID:** `FX6bv7g3sxAkjfhj`
**Trigger:** Execute Workflow Trigger — chamado pelo Fluxo 2 com `{ phone, instancia, mensagem }`
**Responsabilidade:** Responder o médico com IA, classificar intenção e rotear ação.

**Sequência real (20 nodes):**
```
When Executed by Another Workflow
→ Edit Fields                   (set: normaliza inputs)
→ AI Agent — Ana Medflow1       (LangChain Agent)
     ├── Model:  OpenAI Chat
     ├── Memory: Postgres Chat Memory (histórico por médico)
     └── Tool:   Informações do Medico (Google Sheets Tool — leitura de dados reais)
→ Refinar Mensagem IA           (code: pós-processa output do agente)
→ Switch por Intent1            (4 saídas: CONFIRMATION, REJECTION, QUESTION, TRANSFER)
   ├── saída 0 → meta enviar texto    (QUESTION/resposta padrão — Meta API)
   ├── saída 1 → meta enviar texto1   → Call 'Fluxo 4 - Envio de Contratos (ClickSign)'
   ├── saída 2 → meta enviar texto3   → Redis5  (TRANSFER: grava flag de atendimento humano)
   └── saída 3 → meta enviar texto2   (REJECTION: mensagem de despedida)
```

**Utilitários (manual):**
- `.` (Manual Trigger) → `Apagador de Memoria` → `Apagador de Memoria1` — limpa as duas memórias Postgres usadas em testes.

**Gap conhecido — sub-fluxo REJECTION:**
A saída 3 do switch hoje só envia a mensagem de despedida via WhatsApp. **Falta implementar:**
- Upsert em `doctors_rejections` (increment count, append em `rejection_history`)
- Update `receivables.status = 'rejected'`
- Insert em `operation_logs` (tipo=REJECTION)

**Reenvio:** acionado manualmente por enquanto (não automatizado). Sem limite de rejeições — `status` permanece `active` mesmo após múltiplos `REJECTION`.

---

### Fluxo 4 — Envio de Contrato Termos (ClickSign)

**Workflow ID:** `UBxeuuB9tt9Osfs3`
**Trigger:** Execute Workflow Trigger (`Intent Confirmation`) — chamado pelo Fluxo 3 com dados do médico
**Responsabilidade:** Gerar contrato de Termos de Serviço a partir de template no Google Docs, enviar para assinatura via ClickSign e notificar o médico.

**Sequência real (caminho principal):**
```
Intent Confirmation (executeWorkflowTrigger)
→ Pegar Informações de antecipação  (Google Sheets — dados da antecipação)
→ Autenticação                       (HTTP — Celcoin OAuth2 → Bearer token)
→ Buscar medico pelo CPF             (HTTP — GET /persons na Celcoin)
→ Medico Encontrado?                 (IF)
→ Informações Medico Celcoin         (set: consolida objeto médico)

[Gerar documento a partir do template Google Docs]
→ Criar Pasta                        (Google Drive — pasta por médico)
→ Copiar Contrato para Pasta         (Google Drive — clona template)
→ Editar Contrato                    (Google Docs — substitui placeholders)
→ Baixar Contrato Editado            (Google Drive — exporta PDF)
→ Wait                               (espera processamento)

[Upload e assinatura ClickSign]
→ Clicksign criar arquivo            (code: monta payload base64)
→ Wait 1s (rate limit)
→ ClickSign - Criar Signatário       (HTTP — POST /signers)
→ Wait 1s (rate limit) 2
→ ClickSign - Vincular Signatário ao Documento (HTTP — POST /lists)
→ Wait 1s (rate limit) 3

[Persistência + notificação]
→ Buscar medico                      (Supabase — fetch doctor_id)
→ Salvar Contrato Termos Supabase    (Supabase — insert em contracts_termos_servico)
→ meta enviar texto                  (HTTP — Meta API)
→ ClickSign - Notificar WhatsApp     (HTTP — ClickSign envia notificação oficial)
```

**Nodes não conectados (testes/sandbox):** `HTTP Request`, `Autenticação1`, `HTTP Request1`, `Autenticação2` — chamadas avulsas para experimentação Celcoin, sem efeito no fluxo principal.

**Stack de templating:** Google Drive (pasta + cópia) + Google Docs (substituição de placeholders) → PDF baixado e enviado à ClickSign.

---

### Fluxo 5 — Emissão de CCB (Celcoin/FlowFinance)

**Workflow ID:** `wqyQKymnaXLTFazA`
**Trigger:** Execute Workflow Trigger (`Fluxo Anterior`) — chamado pelo **Fluxo 6 Ramo A** após assinatura dos Termos
**Responsabilidade:** Emitir CCB registrada no BACEN via Celcoin e enviar link ZapSign de assinatura.

**Sequência real (18 nodes):**
```
Fluxo Anterior (executeWorkflowTrigger)
→ Buscar Médico Google Sheets        (lookup por phone)
→ Médico Encontrado na tabela?       (IF — Stop and Error se não)
→ Autenticação                       (HTTP — Celcoin OAuth2)
→ Buscar medico pelo CPF             (HTTP — GET /persons)
→ Medico Encontrado?                 (IF)
→ Preparar Solicitação               (code: monta payload application)
→ Solicitar Empréstimo (CCB)         (HTTP — POST /applications)
→ Extrair Application ID             (code)
→ Aguardar Rendering                 (Wait — Celcoin processa AGREEMENT_RENDERING)
→ Buscar Link Assinatura             (HTTP — GET /applications/{id}/signatures)
→ Buscar Assinaturas                 (HTTP — pega collect_sign_link)
→ [paralelo — 3 ramos]
   ├── Buscar medico Supabase  → Salvar Contrato Supabase  (insert em contracts_ccb)
   ├── Log Operação                                         (Supabase — operation_logs)
   └── meta enviar texto                                    (HTTP Meta — envia link ZapSign)
```

**Notas vs versão anterior:**
- Etapa de **simulação** (`POST /applications/preview-total-amount`) **foi removida** do fluxo atual.
- Persistência migrou de HTTP para nodes nativos `n8n-nodes-base.supabase`.
- Envio do link ao médico é via Meta (WhatsApp Cloud API).

**Pré-requisito KYC Celcoin:**
- Pessoa cadastrada em `/persons` com `id_document.type` válido (RG, CNH, etc.)
- Documento `NATIONAL_ID` uploadado via `POST /persons/{id}/documents`
- Chave PIX cadastrada: `{ key_type: "TAXPAYER_ID", key: cpf }`

**Modo de assinatura:** `LINK` — Celcoin retorna URL ZapSign via `collect_sign_link`.

---

### Fluxo 6 — Sinal quando Assinado

**Workflow ID:** `kr8Ou1tefMyzEDnB`
**Trigger:** Dois webhooks independentes — ClickSign e Celcoin
**Responsabilidade:** Processar confirmações de assinatura e acionar próximas etapas.

---

#### Ramo A — Webhook ClickSign (Termos de Serviço assinado)

```
Webhook ClickSign
→ Extrair Dados ClickSign       (code: parseia payload, extrai document_key, signer, status)
→ Buscar Contrato Termos        (Supabase — fetch em contracts_termos_servico por document_key)
→ Buscar Doctor ClickSign       (Supabase — fetch doctor pela FK doctor_id)
→ [paralelo — 3 ramos]
   ├── Atualizar Termos Supabase     (update status=signed, signed_at, clicksign_status)
   ├── Preparar Dados Fluxo 5  → Acionar Fluxo 5  (executeWorkflow — emite CCB)
   └── meta enviar texto             (HTTP Meta — avisa médico que Termos foi assinado)
```

#### Ramo B — Webhook Celcoin (CCB assinada)

**Webhook URL (produção):**
`https://automacao-medflow-n8n.zhe0xi.easypanel.host/webhook/97b530ad-edff-47cf-ac03-09aa6792cda7`

```
Webhook Celcoin
→ Extrair Dados Assinatura      (code: parseia payload, extrai application_id, status)
→ Buscar Contrato CCB           (Supabase — fetch em contracts_ccb por celcoin_operation_id)
→ Buscar Doctor CCB             (Supabase — fetch doctor pela FK doctor_id)
→ [paralelo — 2 ramos]
   ├── Atualizar Contrato Supabase  (update status=signed, signed_at, celcoin_status)
   └── meta enviar texto1           (HTTP Meta — agradecimento, valor em breve)
```

**Falta:** node `Log Assinatura` existe no grafo mas está desconectado (id `log-sign-001`) — possivelmente substituído pelo update + Supabase nativo.

---

## Arquitetura de Dados

### Celcoin / FlowFinance (banco externo)
Celcoin mantém banco próprio com dados completos de cada operação: pessoa, aplicação CCB, assinaturas, documentos KYC, simulações, histórico financeiro. Medflow consome via API — não replica tudo no Supabase, apenas o essencial para rastreamento interno.

---

### Google Sheets
**ID:** `1A5rjuCrQaQN9Lhb6EqnLa1i0yfOCG_MdMHP6Nvp8Oc4`
Fonte primária das antecipações e informações dos médicos. Colunas: phone, nome, CPF, valor disponível, taxa, prazo, dados bancários, status de aprovação.

### Google Drive + Google Docs
Templating de contratos de Termos de Serviço no Fluxo 4: pasta por médico, cópia do template, substituição de placeholders, export para PDF.

### Supabase
**Project ref:** `ijankjcupfdfqhvulrfh`

| Tabela | Status | Uso |
|--------|--------|-----|
| `doctors` | existente | Cadastro de médicos (upsert no Fluxo 1 e Fluxo 2) |
| `contracts_ccb` | existente | Contratos CCB emitidos via Celcoin |
| `contracts_termos_servico` | existente | Contratos ClickSign (Termos de Serviço) |
| `operation_logs` | existente | Log de todas as operações por médico |
| `doctors_rejections` | existente | Estado agregado de rejeições/engajamento por médico (1:1 com doctors) |
| `receivables` | existente | Antecipações disponíveis por médico (status inclui `rejected`) |

**`contracts_ccb`:**
- `id` — uuid PK
- `doctor_id` — FK → doctors
- `celcoin_operation_id` — application_id da Celcoin
- `celcoin_status` — status raw da Celcoin
- `sign_link` — URL ZapSign (collect_sign_link)
- `contract_url` — URL do documento
- `status` — `pending` | `sent` | `signed` | `cancelled` | `expired`
- `sent_at`, `signed_at`, `cancelled_at`, `expires_at`
- `created_at`, `updated_at`

**`contracts_termos_servico`:**
- `id` — uuid PK
- `doctor_id` — FK → doctors
- `clicksign_document_key` — document_id ClickSign
- `clicksign_request_signature_key`
- `clicksign_status` — status raw da ClickSign
- `contract_url`
- `status` — `pending` | `sent` | `signed` | `cancelled` | `expired`
- `sent_at`, `signed_at`, `cancelled_at`, `expires_at`
- `created_at`, `updated_at`

**`operation_logs`** (colunas de contrato):
- `ccb_contract_id` — FK nullable → contracts_ccb
- `termos_contract_id` — FK nullable → contracts_termos_servico

**`doctors_rejections`** — schema verificado contra `doctors` real (PK `id uuid`):
- `id` — uuid PK default `gen_random_uuid()`
- `doctor_id` — uuid FK → `doctors.id` (unique — 1:1 com doctor)
- `phone` — varchar (denormalizado pra lookup rápido do Fluxo 3)
- `status` — varchar default `'active'`, check IN (`'active'`, `'opted_out'`, `'signed'`)
- `rejection_count` — int default 0
- `last_rejected_at` — timestamptz nullable
- `rejection_reason` — text nullable (último motivo capturado pela IA)
- `rejection_history` — jsonb default `'[]'` (append-only: `[{ rejected_at, reason, receivable_id?, message_id }]`)
- `created_at`, `updated_at` — timestamptz default `now()`

**`receivables`:** status enum estendido para `available | offered | accepted | contracted | paid | rejected`. Colunas adicionadas: `rejected_at timestamptz`, `rejection_reason text`. Sub-fluxo REJECTION deve atualizar atomicamente `receivable` + upsert `doctors_rejections`.

### Redis
Cache de estado de atendimento. Chave por phone. Usado para:
- Sinalizar transferência para humano (gravado pelo Fluxo 3 saída TRANSFER → node `Redis5`)
- Controlar pausa após finalização

### PostgreSQL
Memória das conversas do agente Ana (Fluxo 3) — `Postgres Chat Memory`. Histórico por médico.

---

## Integrações Externas

### Celcoin / FlowFinance
- **Ambiente:** Sandbox (`sandbox.platform.flowfinance.com.br`)
- **Auth:** Basic Auth → `client_credentials` → Bearer token (~1h TTL)
- **Credencial n8n:** ID `nUAcFOPzE1fWKMXU` ("Auth Celcoin")
- **Produto/Funding:** env vars `CELCOIN_PRODUCT_ID`, `CELCOIN_FUNDING_ID`
- **Assinatura digital:** ZapSign (via Celcoin) — `app.zapsign.com.br/verificar/...`

### ClickSign
- Geração e assinatura de contratos de Termos de Serviço (Fluxo 4)
- Notificação oficial via API (`ClickSign - Notificar WhatsApp`)
- Webhook de documento assinado consumido pelo Fluxo 6 Ramo A

### WhatsApp Cloud API (Meta)
- Envio de mensagens em **todos** os fluxos via nodes `meta enviar texto*` (HTTP Request)
- Webhook de recebimento alimenta o Fluxo 2 (`meta1`)
- **Substitui Evolution API** nas versões atuais

### OpenAI
- Modelo: GPT (configurado no node `OpenAI Chat` do Fluxo 3)
- Usado pelo AI Agent (LangChain) com tool de Google Sheets e memória Postgres

### Google Workspace
- Sheets (todos os fluxos): planilha mestra de antecipações
- Drive (Fluxo 4): pastas por médico + cópia de template
- Docs (Fluxo 4): substituição de placeholders no contrato

---

## Credenciais n8n

| Serviço | ID Credencial | Nome |
|---------|--------------|------|
| Celcoin Basic Auth | `nUAcFOPzE1fWKMXU` | Auth Celcoin |
| Google Sheets | `KUzlSxm9Z7LCNAkR` | Google Sheets account |
| Supabase | `PBRtbhImrvfXokbu` | Supabase account 2 |

---

## Variáveis de Ambiente (n8n)

| Variável | Uso |
|----------|-----|
| `CELCOIN_PRODUCT_ID` | ID do produto CCB na Celcoin |
| `CELCOIN_FUNDING_ID` | ID do funding na Celcoin |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | Service role key do Supabase |

---

## Pendências

- [x] **Supabase:** Tabelas `contracts_ccb` e `contracts_termos_servico` criadas, `contracts` removida
- [x] **Supabase:** Tabela `doctors_rejections` criada + `receivables` recebeu colunas `rejected_at`, `rejection_reason`
- [x] **Fluxo 6 Ramo A:** Implementado (Webhook ClickSign → update Supabase + aciona Fluxo 5 + avisa médico)
- [x] **Fluxo 6 Ramo B:** Implementado (Webhook Celcoin → update Supabase + avisa médico)
- [x] **Fluxo 5:** Migrou persistência para nodes Supabase nativos
- [ ] **Fluxo 3 REJECTION branch:** Hoje só envia mensagem de despedida. Falta: upsert `doctors_rejections` + update `receivables.status='rejected'` + insert `operation_logs`
- [ ] **Fluxo 2 buffer:** Reativar debounce (`generic-buffer` está desabilitado) — atualmente mensagens entram direto no Fluxo 3
- [ ] **Fluxo 4:** Limpar nodes desconectados (`HTTP Request`, `Autenticação1`, `HTTP Request1`, `Autenticação2`)
- [ ] **Fluxo 6:** Conectar node `Log Assinatura` (existe no grafo, desconectado) ou remover se substituído
- [ ] **Fluxo 5:** Verificação KYC antes de emitir CCB (para produção)
- [ ] **Produção:** Migrar URLs Celcoin de sandbox para produção
- [ ] **Supabase env vars:** Validar `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` nos nodes do Fluxo 5
