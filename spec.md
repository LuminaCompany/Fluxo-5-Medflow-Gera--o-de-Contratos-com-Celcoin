# Medflow — Especificação do Produto

## Visão Geral

Medflow é uma plataforma de **antecipação de recebíveis para médicos**, operada via WhatsApp com IA conversacional. O médico recebe um aviso, confirma pelo WhatsApp, assina dois contratos digitais e recebe o valor antecipado, ainda não sabemos como.

**Stack principal:** n8n · Celcoin/FlowFinance · ClickSign · Evolution API (WhatsApp) · OpenAI/Groq · Supabase · Google Sheets · Redis · API Oficial · Insomnia

**n8n instance:** `https://automacao-medflow-n8n.zhe0xi.easypanel.host`

---

## Jornada do Médico (macro)

```
Médico recebe aviso no WhatsApp (Fluxo 1)
  ↓
Médico responde confirmando (WhatsApp → Fluxo 2 → Fluxo 3) - ou avisa que não quer assim IA classifica como REJECTION e desliga o atendimento.
  ↓
IA classifica intenção como CONFIRMATION
  ↓
Contrato de Termos de Serviço gerado e enviado (Fluxo 4A — ClickSign)
  ↓
Médico assina Termos de Serviço
  ↓
CCB emitida no BACEN e enviada para assinatura (Fluxo 5 — Celcoin)
  ↓
Médico assina CCB
  ↓
Ambos contratos assinados → operação finalizada (Fluxo 6)
```

---

## Fluxos

### Fluxo 1 — Aviso de Recebimento Disponível

**Trigger:** Cron diário às 8h (ou disparo manual)

**Responsabilidade:** Notificar médicos com valor disponível para antecipação.

**Sequência:**
1. Lê planilha Google Sheets com dados dos médicos
2. Filtra médicos elegíveis (com valor disponível e data de )
3. Dispara mensagem personalizada via WhatsApp (Evolution API) com o valor disponível

---

### Fluxo 2 — Receptor e Roteador de Mensagens

**Trigger:** Webhook — toda mensagem recebida no WhatsApp

**Responsabilidade:** Receber, filtrar e encaminhar mensagens para a IA.

**Sequência:**
1. Recebe mensagem via webhook Evolution API
2. Verifica no Redis se há humano em atendimento ativo (se sim, ignora)
3. Agrupa mensagens rápidas em buffer de 10 segundos (debounce)
4. Encaminha mensagem + dados do médico para o Fluxo 3

---

### Fluxo 3 — Agente Conversacional (Ana)

**Trigger:** Chamado pelo Fluxo 2 com `{ phone, instancia, mensagem }`

**Responsabilidade:** Responder o médico com IA e classificar intenção.

**Sequência:**
1. Recebe mensagem e identifica médico
2. Busca dados reais do médico (valor, prazo, taxa) na planilha
3. Consulta memória de conversa no PostgreSQL
4. IA (GPT-4o Mini / Groq) responde usando FAQ + dados reais
5. Salva memória atualizada no PostgreSQL
6. Classifica intenção: `CONFIRMATION` · `REJECTION` · `TRANSFER` · `QUESTION`
7. Switch roteia baseado na intenção:
   - `CONFIRMATION` → aciona Fluxo 4
   - `TRANSFER` → ativa atendimento humano no Redis
   - `REJECTION` / `QUESTION` → resposta simples ou encerra

---

### Fluxo 4A — Geração de Contrato ClickSign (Termos de Serviço)

**Trigger:** Chamado pelo Fluxo 3 quando intenção = `CONFIRMATION`

**Responsabilidade:** Gerar e enviar contrato de termos de serviço para assinatura.

**Sequência:**
1. Busca dados completos do médico na planilha
2. Cria documento na ClickSign com template preenchido
3. Adiciona médico como signatário
4. Envia link de assinatura via WhatsApp e/ou email
5. Salva contrato no Supabase (`contracts` table)

---

### Fluxo 5 — Emissão de CCB (Celcoin/FlowFinance)

**Workflow ID:** `wqyQKymnaXLTFazA`  
**Trigger:** Chamado após assinatura do contrato ClickSign com `{ phone, instancia, mensagem }`

**Responsabilidade:** Emitir CCB registrada no BACEN via Celcoin e enviar para assinatura digital.

**Sequência:**
```
Chamado pelo Fluxo 4A
→ Preparar Busca              (limpa phone: remove @s.whatsapp.net, só dígitos)
→ Buscar Médico Google Sheets (lookup por coluna phone)
→ Médico Encontrado?          (IF: aborta se não encontrado)
→ Mapear Dados p/ Celcoin     (map colunas → objeto médico estruturado)
→ Autenticar Celcoin          (POST oauth2/token, Basic Auth → Bearer token)
→ Extrair Token               (merge token + dados médico em objeto único)
→ Buscar Pessoa Celcoin       (GET /persons — lista completa)
→ Extrair Person Celcoin      (filtra por phone: area_code + number)
→ Simular Empréstimo          (POST /applications/preview-total-amount)
→ Preparar Solicitação        (merge simulação + dados médico)
→ Solicitar Empréstimo (CCB)  (POST /applications — signature_collect_method: LINK)
→ Extrair Application ID      (extrai application_id)
→ Aguardar Rendering          (Wait 30s — Celcoin processa AGREEMENT_RENDERING)
→ Buscar Link Assinatura      (GET /applications/{id}/signatures → collect_sign_link)
→ [paralelo]
   ├── Salvar Contrato Supabase   (POST /rest/v1/contracts)
   ├── Log Operação               (POST /rest/v1/operation_logs)
   └── Enviar texto               (Evolution API — envia link ZapSign ao médico)
```

**Pré-requisito KYC Celcoin:**
- Pessoa cadastrada em `/persons` com `id_document.type` válido (RG, CNH, etc.)
- Documento `NATIONAL_ID` uploadado via `POST /persons/{id}/documents`
- Chave PIX cadastrada: `{ key_type: "TAXPAYER_ID", key: cpf }`

**Modo de assinatura:** `LINK` — Celcoin retorna URL ZapSign via `collect_sign_link`

---

### Fluxo 6 — Assinatura e Finalização

**Workflow ID:** `kr8Ou1tefMyzEDnB`  
**Trigger:** Dois webhooks independentes — ClickSign e Celcoin

**Responsabilidade:** Processar confirmações de assinatura de cada contrato separadamente e acionar próximas etapas.

---

#### Ramo A — Webhook ClickSign (Termos de Serviço assinado)

**Trigger:** ClickSign envia evento de documento assinado

**Sequência:**
```
Webhook ClickSign
→ Extrair Dados ClickSign     (Code: parseia payload, extrai document_id, signer phone/email, status)
→ [paralelo]
   ├── Atualizar Supabase      (update contracts_termos_servico SET status=signed, signed_at)
   └── Avisar Médico           (Evolution API — avisa que termos foram assinados, CCB será emitida em breve)
→ Acionar Fluxo 5             (chama workflow de emissão CCB com dados do médico)
```

**Tabela Supabase:** `contracts_termos_servico` *(a criar)*  
Campos: `document_id`, `phone`, `status`, `signed_at`, `clicksign_status`

---

#### Ramo B — Webhook Celcoin (CCB assinada)

**Trigger:** Celcoin envia evento `APPLICATION_SIGNED`

**Webhook URL (produção):**
`https://automacao-medflow-n8n.zhe0xi.easypanel.host/webhook/97b530ad-edff-47cf-ac03-09aa6792cda7`

**Sequência:**
```
Webhook Celcoin
→ Extrair Dados Assinatura    (Code: parseia payload, extrai application_id, status, borrower)
→ [paralelo]
   ├── Atualizar Supabase      (update contracts_ccb SET status=signed, signed_at, celcoin_status)
   └── Mensagem de Agradecimento (Evolution API — parabéns, antecipação concluída, valor em breve)
```

**Tabela Supabase:** `contracts_ccb`  
Campos: `celcoin_operation_id`, `phone`, `status`, `signed_at`, `celcoin_status`

---

## Arquitetura de Dados

### Celcoin / FlowFinance (banco de dados externo)
Celcoin mantém banco próprio com dados completos de cada operação: pessoa, aplicação CCB, assinaturas, documentos KYC, simulações, histórico financeiro, entre muitos outros. O Medflow consome via API — não replica tudo no Supabase, apenas o essencial para rastreamento interno.

---

### Google Sheets
**ID:** `1A5rjuCrQaQN9Lhb6EqnLa1i0yfOCG_MdMHP6Nvp8Oc4`  
Fonte primária de dados das antecipações e algumas informações dos médicos. Colunas: phone, nome, CPF, valor disponível, taxa, prazo, dados bancários.

### Supabase
**Project ref:** `ijankjcupfdfqhvulrfh`

| Tabela | Status | Uso |
|--------|--------|-----|
| `contracts_ccb` | **existente** | Contratos CCB emitidos via Celcoin |
| `contracts_termos_servico` | **existente** | Contratos ClickSign (Termos de Serviço) |
| `operation_logs` | existente | Log de todas as operações por médico |

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

### Redis
Cache de estado de atendimento. Chave por phone. Usado para:
- Verificar se humano está em atendimento ativo
- Controlar pausa após finalização

### PostgreSQL
Memória das conversas do agente Ana (Fluxo 3). Histórico por médico.

---

## Integrações Externas

### Celcoin / FlowFinance
- **Ambiente:** Sandbox (`sandbox.platform.flowfinance.com.br`)
- **Auth:** Basic Auth → `client_credentials` → Bearer token (~1h TTL)
- **Credencial n8n:** ID `nUAcFOPzE1fWKMXU` ("Auth Celcoin")
- **Produto/Funding:** env vars `CELCOIN_PRODUCT_ID`, `CELCOIN_FUNDING_ID`
- **Assinatura digital:** ZapSign (via Celcoin) — `app.zapsign.com.br/verificar/...`

### ClickSign
- Geração e assinatura de contratos de termos de serviço
- Template preenchido com dados do médico

### Evolution API (WhatsApp)
- Envio de mensagens para médicos
- Recebimento via webhook (Fluxo 2)

### OpenAI / Groq
- Modelo: GPT-4o Mini (ou Groq como fallback)
- Usado no Fluxo 3 para respostas + classificação de intenção

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
- [ ] **Fluxo 6 Ramo A:** Implementar webhook ClickSign no n8n (parsear payload ClickSign, atualizar Supabase, avisar médico, acionar Fluxo 5)
- [ ] **Fluxo 6 Ramo B:** Testar webhook Celcoin end-to-end (registrar webhook na Celcoin com URL de produção)
- [ ] **Fluxo 5:** Node de verificação KYC antes de emitir CCB (para produção)
- [ ] **Produção:** Migrar URLs Celcoin de sandbox para produção
- [ ] **Supabase env vars:** Validar `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` nos nodes do Fluxo 5
