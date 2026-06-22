# Pendências MedFlow — Análise dos 6 Fluxos

> **Como usar este arquivo:**
> - Cada fix tem checkbox `[ ]` antes da descrição.
> - Ao implementar um fix, troque `[ ]` por `[x]`.
> - Itens estão organizados por prioridade (P0 crítico → P3 cosmético).
> - Cada item lista: arquivo/node afetado, problema, solução detalhada, e quando aplicável, snippet de código/config.
> - Workflow IDs:
>   - Fluxo 1: `l6gvSDfxYZFibLG1` — Verificação e Disparo
>   - Fluxo 2: `OwQhnPQB5MrjTWYz` — Buffer/Prosseguimento
>   - Fluxo 3: `FX6bv7g3sxAkjfhj` — Agente Conversacional (Ana)
>   - Fluxo 4: `UBxeuuB9tt9Osfs3` — Envio Contrato Termos (ClickSign)
>   - Fluxo 5: `wqyQKymnaXLTFazA` — Emissão CCB (Celcoin)
>   - Fluxo 6: `kr8Ou1tefMyzEDnB` — Sinal quando Assinado
> - Use `mcp__n8n-mcp__n8n_update_partial_workflow` para mudanças cirúrgicas; `n8n_update_full_workflow` para reestruturação.
> - Sempre validar com `n8n_validate_workflow` (profile: runtime) após mudanças.

---

## 🔴 P0 — CRÍTICO (quebra produção, vaza segredo, ou contabilidade errada)

### P0-1. Fluxo 5 — `interest_rate: 0.07` hardcoded contradiz spec "taxa 3,5%"
- [X] **Fix**
- **Workflow:** Fluxo 5 (`wqyQKymnaXLTFazA`)
- **Node:** `Solicitar Empréstimo (CCB)`
- **Problema:** Body JSON da requisição POST `/applications` envia `"interest_rate": 0.07` (7%). Spec e prompt Ana dizem 3,5%. CCB registrada na Celcoin com taxa DOBRO da prometida ao médico.
- **Solução:**
  1. Criar env var `CELCOIN_INTEREST_RATE=0.035` no n8n.
  2. Trocar `"interest_rate": 0.07,` por `"interest_rate": {{ $env.CELCOIN_INTEREST_RATE }},`
  3. Confirmar com Lucas/financeiro qual valor real antes de aplicar.
  4. Considerar mover taxa pra tabela `system_config` (já existe no Supabase) pra mudança sem redeploy.

### P0-2. Fluxo 5 — `product.id` e `funding.id` hardcoded vs spec exige env vars
- [ ] **Fix**
- **Workflow:** Fluxo 5
- **Node:** `Solicitar Empréstimo (CCB)`
- **Problema:** Body hardcoda `"product": {"id": "3190e65f-9931-4d8e-9f2d-ad20fa86388e"}` e `"funding": {"id": "0e91bcd6-d54e-4534-a69e-ff0dfe7c9d9d"}`. Spec define env vars `CELCOIN_PRODUCT_ID` e `CELCOIN_FUNDING_ID`.
- **Solução:**
  1. Confirmar env vars já existem no n8n; caso não, criar.
  2. Editar jsonBody:
     ```
     "product": { "id": "{{ $env.CELCOIN_PRODUCT_ID }}" },
     "funding": { "id": "{{ $env.CELCOIN_FUNDING_ID }}" },
     ```

### P0-3. Fluxo 4 — Token ClickSign hardcoded em 3 URLs
- [ ] **Fix**
- **Workflow:** Fluxo 4 (`UBxeuuB9tt9Osfs3`)
- **Nodes afetados:**
  - `ClickSign - Criar Signatário`
  - `ClickSign - Vincular Signatário ao Documento`
  - `ClickSign - Notificar WhatsApp`
- **Problema:** URL contém `?access_token=98a2d123-4c4e-4718-8e17-9e22af58d414` em plaintext. Inconsistente com `Clicksign criar arquivo` que usa `$env.CLICKSIGN_API_KEY`.
- **Solução:**
  1. Garantir env vars `CLICKSIGN_API_KEY` e `CLICKSIGN_ENV` existem.
  2. Trocar URL nos 3 nodes:
     ```
     ={{ $env.CLICKSIGN_ENV === 'production' ? 'https://app.clicksign.com' : 'https://sandbox.clicksign.com' }}/api/v1/signers?access_token={{ $env.CLICKSIGN_API_KEY }}
     ```
  3. Rotacionar token atual (foi exposto no git).

### P0-4. Fluxo 2 — Supabase service key hardcoded + header `Authorization\t` com TAB
- [ ] **Fix**
- **Workflow:** Fluxo 2 (`OwQhnPQB5MrjTWYz`)
- **Node:** `Upsert Doctor Supabase` (HTTP Request)
- **Problema:**
  - Header `apikey` = `sb_secret_REDACTED_ROTACIONAR` em plaintext.
  - Header `Authorization\t` tem TAB no nome → n8n ignora → Bearer nunca enviado.
  - `Prefer: resolution=ignore-duplicates` significa que doctor existente NÃO atualiza (silencioso).
- **Solução (substituir HTTP por Supabase node nativo):**
  1. Remover node `Upsert Doctor Supabase`.
  2. Criar `n8n-nodes-base.supabase` com credential `PBRtbhImrvfXokbu` ("Supabase account 2").
  3. Operation: `Upsert` (ou `Update`/`Create` separados se v1 não suportar upsert).
  4. Table: `doctors`, conflict column: `whatsapp`.
  5. Fields:
     - `full_name`: `={{ $('Informações Medico Celcoin').item.json.nome }}`
     - `whatsapp`: `={{ $('Informações Medico Celcoin').item.json.phone.replace(/\+/g, '') }}`
  6. Rotacionar `sb_secret_*` exposto.

### P0-5. Fluxo 6 Ramo B — webhook trata `PENDING_QUALIFICATION` como assinado
- [ ] **Fix**
- **Workflow:** Fluxo 6 (`kr8Ou1tefMyzEDnB`)
- **Node:** `Extrair Dados Assinatura` (Code)
- **Problema:** Filtro atual:
  ```js
  const isSignedEvent = eventType === 'APPLICATION_SIGNED' || status === 'PENDING_QUALIFICATION';
  ```
  `PENDING_QUALIFICATION` = aguardando aprovação manual (NÃO assinou). Workflow marca `contracts_ccb.status='signed'` e envia "🎉 antecipação concluída" antes da assinatura.
- **Solução:**
  ```js
  const isSignedEvent =
      eventType === 'APPLICATION_SIGNED' ||
      status === 'SIGNED' ||
      status === 'CONTRACT_SIGNED';
  ```
  Validar com docs Celcoin qual é o evento/status real de assinatura concluída. Testar com pinData de evento real (não o `PENDING_QUALIFICATION` pinado).

### P0-6. Fluxo 6 Ramo B — `Atualizar Contrato Supabase` filtra por `doctor_id` (afeta todos CCBs)
- [X] **Fix**
- **Workflow:** Fluxo 6
- **Node:** `Atualizar Contrato Supabase`
- **Problema:** Filter `doctor_id eq $json.id` atualiza TODOS os contratos CCB do médico. Se médico tiver histórico com 2 CCBs, ambos viram signed.
- **Solução:**
  - Trocar filter:
    - `keyName: celcoin_operation_id`
    - `condition: eq`
    - `keyValue: ={{ $('Extrair Dados Assinatura').first().json.application_id }}`

### P0-7. Fluxo 1 — sem dedupe / mark-sent quebrado / sem check de rejeição
- [ ] **Fix**
- **Workflow:** Fluxo 1 (`l6gvSDfxYZFibLG1`)
- **Problema:** Cron diário 8h, único filtro é `Valor Disponível > 1`. Mesmo médico recebe mensagem todo dia. `Atualizar Status (Aviso Enviado)` existe mas configurado errado (validator: "Range/Values required").
- **Solução (3 partes):**
  1. **Filter por STATUS:** após `Filtrar Aprovados`, adicionar filter:
     ```
     STATUS != "Aviso de valor disponível enviado"
     AND STATUS != "Em atendimento"
     AND STATUS != "Rejeitou"
     AND STATUS != "Gerando termos de serviço"
     AND STATUS != "Gerando contrato ccb"
     AND STATUS != "Contratos assinados"
     ```
  2. **Check `doctors_rejections`:** dentro do `Verificar Medicos`, consultar `doctors_rejections WHERE phone = ... AND last_offer_at > NOW() - INTERVAL '24h'` → skip se existir.
  3. **Consertar update Sheets:** node `Atualizar Status (Aviso Enviado)` precisa `matchingColumns: ["phone"]` + `phone` e `STATUS` no values. Validar no n8n UI.
  4. **Atualizar `last_offer_at`:** após envio bem-sucedido, upsert `doctors_rejections` com `last_offer_at = NOW()`.

### P0-8. Fluxo 3 — branch REJECTION quebra silenciosamente (doctor_id vazio)
- ´[X] **Fix**
- **Workflow:** Fluxo 3 (`FX6bv7g3sxAkjfhj`)
- **Node:** `Registrar Rejeição (Supabase)` (Postgres)
- **Problema:** Query usa `$('Edit Fields').item.json.doctor_id` que é SEMPRE vazio (trigger só recebe `{phone, instancia, mensagem}`). `$1::uuid` com string vazia = ERRO de cast PostgreSQL.
- **Solução:**
  1. Antes do `Switch por Intent1`, adicionar node Supabase `Buscar Doctor por Phone`:
     - Table: `doctors`, filter: `whatsapp eq {{ $('Edit Fields').item.json.phone }}`, limit 1.
  2. Trocar `$('Edit Fields').item.json.doctor_id` por `$('Buscar Doctor por Phone').first().json.id` na query.
  3. OU reescrever query usando subselect:
     ```sql
     INSERT INTO doctors_rejections (doctor_id, phone, rejection_count, ...)
     VALUES (
       (SELECT id FROM doctors WHERE whatsapp = $2 LIMIT 1),
       $2, 1, ...
     )
     ON CONFLICT (doctor_id) DO UPDATE ...
     ```

### P0-9. Fluxo 5 — `Salvar Contrato Supabase` insere com doctor_id NULL
- [X] **Fix**
- **Workflow:** Fluxo 5
- **Node:** `Buscar medico Supabase`
- **Problema:** Filter `whatsapp eq Extrair Application ID.whatsapp` que é formato `country_code+area_code+number` (vindo Celcoin: `5561998430401`). `doctors.whatsapp` vem do Sheets `phone` (formato pode ser `+55...` ou `5561...`). Mismatch = 0 rows = INSERT FK falha (doctor_id NOT NULL).
- **Solução:**
  1. **Curto prazo:** trocar lookup pra `cpf` (campo único, sem formatação variável):
     - `keyName: cpf`
     - `keyValue: ={{ $('Extrair Application ID').first().json.taxpayer_id }}`
  2. **Longo prazo:** padronizar phone format global (ver #P1-15). Helper sub-workflow `normalize-phone` que remove `+`, garante `55` no início, valida 12-13 dígitos.

### P0-10. Fluxo 2 — Edit Fields1 JSON inválido
- [X] **Fix**
- **Workflow:** Fluxo 2
- **Node:** `Edit Fields1`
- **Problema:** `mode: "raw", jsonOutput: "={\\n \"phone\": ..."`. Prefixo `=` antes do `{` = não é JSON válido. Output corrompido vai pro Fluxo 3.
- **Solução:** trocar pra `mode: "manual"` com assignments:
  ```json
  {
    "assignments": [
      { "name": "phone", "value": "={{ $('Informações Medico Celcoin').item.json.phone }}", "type": "string" },
      { "name": "mensagem", "value": "={{ $('Informações Medico Celcoin').item.json.mensagem }}", "type": "string" },
      { "name": "id", "value": "={{ $('Informações Medico Celcoin').item.json.id }}", "type": "string" }
    ]
  }
  ```

---

## 🟠 P1 — ALTO (perda de dados, race condition, UX quebrada)

### P1-11. Spec OUTDATED — Fluxo 2 não usa Meta direto, usa Chatwoot
- [ ] **Fix (documentação)**
- **Arquivo:** `spec.md`
- **Problema:** Pinned data do webhook `meta1` mostra payload Chatwoot (`body.event=message_created`, `body.conversation.messages[].sender.phone_number`, inbox "Whatsapp API OFICIAL"). Spec inteira fala "Meta API direto".
- **Solução:** atualizar spec:
  - Documentar Chatwoot como middleware entre Meta e n8n.
  - Fluxo 3 saída 0 (QUESTION) envia via Chatwoot API (`automacao-medflow-chatwoot.zhe0xi.easypanel.host`); saídas 1/2/3 enviam Meta direto.
  - Adicionar credencial Chatwoot na lista da spec.

### P1-12. Spec contradição — REJECTION marcado como pendente mas já implementado
- [ ] **Fix (documentação)**
- **Arquivo:** `spec.md` linhas 130-137 e 397
- **Problema:** Spec diz "Falta implementar upsert doctors_rejections + update receivables + log". JÁ ESTÁ implementado no Fluxo 3 (nodes `Registrar Rejeição (Supabase)`, `Adicionar Pausa Reject (24h)`). Apenas bugado (#P0-8).
- **Solução:** marcar item da spec como `[x]` após fixar P0-8. Reescrever seção descrevendo implementação real.

### P1-13. Spec contradição — Verificar Pause Redis no Fluxo 2
- [ ] **Fix (documentação)**
- **Arquivo:** `spec.md` linha 101
- **Problema:** Spec: "Verificação de atendimento humano (Redis) não está nesse fluxo". ESTÁ — nodes `Verificar Pause (Redis)` + `Está Pausado?`.
- **Solução:** atualizar spec descrevendo lógica de pause (Fluxo 3 grava `pause:phone` em Redis com TTL; Fluxo 2 lê e dropa mensagens pausadas).

### P1-14. Fluxo 3 — Stack de mensageria INCONSISTENTE (Chatwoot + Meta misto)
- [ ] **Fix**
- **Workflow:** Fluxo 3
- **Problema:**
  - Saída 0 (QUESTION) → Chatwoot API.
  - Saídas 1/2/3 (CONFIRMATION/TRANSFER/REJECTION) → Meta Graph direto.
  - Médico recebe mensagens por canais diferentes. Chatwoot perde histórico das saídas 1/2/3.
- **Solução (decisão):**
  - **Opção A (recomendada):** unificar tudo via Chatwoot (mantém histórico, permite handoff humano). Trocar `meta enviar texto1/2/3` para mesma chamada Chatwoot que `meta enviar texto`.
  - **Opção B:** unificar tudo via Meta direto. Perde histórico Chatwoot.
  - Confirmar com Lucas qual fluxo prefere antes de aplicar.

### P1-15. Phone normalization global INCONSISTENTE
- [ ] **Fix**
- **Workflows afetados:** todos
- **Problema:** Cada fluxo trata diferente:
  - Fluxo 1: cria `whatsapp` clean, mas `meta enviar texto` usa `phone` cru do Sheets.
  - Fluxo 2: `.replace(/\+/g, '')` em alguns lugares, sem strip em outros.
  - Fluxo 3: `.replace(/\+/g, '')` no Edit Fields.
  - Fluxo 4: phone com `+` em alguns nodes, sem em outros.
  - Fluxo 5: `.replace('+', '')` (só primeiro).
- **Solução:**
  1. Criar workflow `helper-normalize-phone` com Code node:
     ```js
     return [{ json: {
       phone_clean: String($json.phone || '')
         .replace(/[^0-9]/g, '')      // só dígitos
         .replace(/^0+/, '')          // remove zeros à esquerda
         .replace(/^(?!55)(\d{10,11})$/, '55$1')  // garante 55
     }}];
     ```
  2. Chamar via `executeWorkflow` em todo fluxo que recebe phone externo.
  3. Padronizar `doctors.whatsapp` no DB com mesmo formato (rodar migration de limpeza).

### P1-16. Fluxo 4 — Documento ClickSign com placeholders vazios
- [ ] **Fix**
- **Workflow:** Fluxo 4
- **Node:** `Editar Contrato`
- **Problema:** Placeholders sem `replaceText`: `{Órgão Emissor do RG}`, `{CEP}`, `{Cidade}`, `{UF}`, `{Número do RG}`. Ficam literais no doc final que médico assina.
- **Solução:**
  1. Puxar dados completos KYC: `Buscar medico pelo CPF` já retorna `id_document` da Celcoin — usar `.number`, `.issuer`. Endereço completo precisa ser parseado de `address` (Celcoin retorna string única).
  2. Adicionar `replaceText` em cada placeholder:
     - `{Número do RG}` → `={{ $('Buscar medico pelo CPF').item.json.content[0].id_document.number }}`
     - `{Órgão Emissor do RG}` → `={{ $('Buscar medico pelo CPF').item.json.content[0].id_document.issuer }}`
     - CEP/Cidade/UF: parsear `address` ou puxar do Supabase `doctors` (já tem `zip_code`, `city`, `state`).
  3. Se dado não existir, substituir por `-` ou `N/A` (não deixar `{placeholder}` cru).

### P1-17. Fluxo 4 — KYC fraco no signer ClickSign
- [ ] **Fix**
- **Workflow:** Fluxo 4
- **Node:** `ClickSign - Criar Signatário`
- **Problema:** Auth só por WhatsApp. Selfie, liveness, doc oficial todos `false`. Qualquer um com acesso ao WhatsApp do médico assina.
- **Solução produção:** alterar jsonBody:
  ```json
  {
    "signer": {
      ...
      "auths": ["whatsapp", "selfie"],
      "selfie_enabled": true,
      "official_document_enabled": true,
      "liveness_enabled": true,
      "facial_biometrics_enabled": false
    }
  }
  ```
  Confirmar custo extra ClickSign e impacto UX antes.

### P1-18. Fluxo 4 — split-brain sandbox/produção (Code respeita env, HTTP não)
- [ ] **Fix**
- **Workflow:** Fluxo 4
- **Nodes:** `Clicksign criar arquivo` (Code) vs `Criar Signatário`/`Vincular`/`Notificar` (HTTP)
- **Problema:** Code switcha entre `app.clicksign.com` e `sandbox.clicksign.com` via `$env.CLICKSIGN_ENV`. HTTP nodes hardcodam `sandbox.clicksign.com`. Em prod: upload vai pra prod, signer fica em sandbox = documento órfão.
- **Solução:** aplicar mesma expressão dos 3 HTTPs (ver P0-3 acima — já cobre).

### P1-19. Fluxo 6 — `Preparar Dados Fluxo 5` hardcoda `instancia: 'lumina'`
- [ ] **Fix**
- **Workflow:** Fluxo 6
- **Node:** `Preparar Dados Fluxo 5` (Code)
- **Problema:** `instancia: 'lumina'` hardcoded. Fluxo 5 propaga adiante; mensagem CCB perde vínculo com conversa Chatwoot original.
- **Solução:**
  1. Buscar última conversa Chatwoot do médico (HTTP GET Chatwoot API filtrado por phone).
  2. OU cachear `instancia` em Redis quando médico interage (Fluxo 3), recuperar aqui:
     ```js
     // Em Fluxo 3: set Redis pause:instancia:{phone} = conversation_id
     // Em Fluxo 6 Preparar Dados: get Redis pause:instancia:{phone}
     ```
  3. OU adicionar coluna `chatwoot_conversation_id` em `doctors` e persistir.

### P1-20. Fluxo 6 — Log Assinatura DESCONECTADO
- [ ] **Fix**
- **Workflow:** Fluxo 6
- **Node:** `Log Assinatura` (id `log-sign-001`)
- **Problema:** Node existe mas não tem conexão de entrada. Insert em `operation_logs` perdido = sem auditoria assinatura CCB.
- **Solução:** decidir entre:
  - **(a) Conectar:** após `Buscar Doctor CCB` → paralelo com `Atualizar Contrato Supabase` e `meta enviar texto1` → `Log Assinatura`.
  - **(b) Remover:** se update do `contracts_ccb.signed_at` já é auditoria suficiente.
  - Recomendado (a) — log explícito facilita debugging.

### P1-21. Fluxo 1 — sem populate de `receivables`
- [ ] **Fix**
- **Workflow:** Fluxo 1
- **Problema:** Tabela `receivables` existe (schema completo com `status` enum `available|offered|accepted|contracted|paid|rejected`), 0 rows. Fluxo 1 nunca insere. Fluxo 3 REJECTION tenta `UPDATE receivables WHERE status IN ('available','offered')` = sempre 0 rows.
- **Solução:**
  1. Após `Atualizar Ou inserir Medicos`, adicionar node Supabase `Inserir Receivable`:
     - Table: `receivables`
     - Fields:
       - `doctor_id`: `={{ $json.medico_id }}`
       - `hospital_clinic`: `Santa Casa de Lorena` (ou variável)
       - `reference_period`: `={{ $json.periodo_referencia }}`
       - `gross_value`: `={{ $json.valor_bruto }}`
       - `net_value`: `={{ $json.valor_liquido }}`
       - `discount_rate`: `={{ $json.taxa_desconto }}`
       - `discount_amount`: `={{ $json.valor_desconto }}`
       - `due_date`: `={{ $json.data_vencimento }}`
       - `status`: `offered`
       - `offered_at`: `={{ new Date().toISOString() }}`
  2. Após `meta enviar texto`, considerar update `status='offered'` com `offered_at`.

### P1-22. Webhooks sem HMAC validation, sem response 200
- [ ] **Fix**
- **Workflows:** Fluxo 2 (`meta1`), Fluxo 6 (`Webhook ClickSign`, `Webhook Celcoin`)
- **Problema:**
  - ClickSign envia header `content-hmac: sha256=...` — workflow ignora. Qualquer um pode forjar request POST e marcar contrato como signed.
  - Celcoin webhook idem (assinatura via header também).
  - Webhooks não retornam response → Meta/ClickSign/Celcoin reenviam achando que falhou.
- **Solução (3 partes):**
  1. **HMAC ClickSign:** após `Webhook ClickSign`, Code node:
     ```js
     const crypto = require('crypto');
     const secret = $env.CLICKSIGN_WEBHOOK_SECRET;
     const sigHeader = $input.first().json.headers['content-hmac'] || '';
     const raw = JSON.stringify($input.first().json.body);
     const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
     if (sigHeader !== expected) throw new Error('HMAC invalido');
     return $input.all();
     ```
  2. **HMAC Celcoin:** validar conforme docs Celcoin (header `x-celcoin-signature` ou similar — confirmar).
  3. **Response:** adicionar `n8n-nodes-base.respondToWebhook` no início de cada fluxo, antes do processamento:
     - `Webhook` → `Respond to Webhook (200)` → `Code parse + processar`.
     - Habilita `Webhook → Response Mode: When Last Node Finishes` OU usar respondToWebhook explícito.

---

## 🟡 P2 — MÉDIO (eficiência, dívida técnica, robustez)

### P2-23. Fluxo 1 — node `Atualizar Status (Aviso Enviado)` mal configurado
- [ ] **Fix**
- **Workflow:** Fluxo 1
- **Node:** `Atualizar Status (Aviso Enviado)`
- **Problema:** Validator: "Range/Values required" (pode ser falso positivo do v4.7 mappingMode). Combinado com `STATUS: "Aviso de valor disponível enviado"` (string fixa, não expressão), sugere nunca testado.
- **Solução:**
  1. Abrir node no n8n UI, verificar se `matchingColumns: ["phone"]` aplica.
  2. Garantir values:
     - `phone`: `={{ $('Ler Google Sheets').item.json.phone }}`
     - `STATUS`: `Aviso de valor disponível enviado`
  3. Testar com pinData → executar único.

### P2-24. Fluxo 2 — `Está Pausado?` saída 0 (pausado) descarta silencioso
- [ ] **Fix**
- **Workflow:** Fluxo 2
- **Node:** `Está Pausado?`
- **Problema:** Pausado (saída 0) → array vazio = mensagem some sem aviso. Não há log nem notificação humano.
- **Solução:**
  1. Conectar saída 0 a Code node `Log Pause Drop`:
     - Insert em `operation_logs` com `action: 'message_dropped_paused'`, `details: { phone, mensagem }`.
  2. Opcionalmente notificar agente Chatwoot via API (assignar conversa).

### P2-25. Fluxo 2 — buffer `generic-buffer` disabled mas referenciado
- [ ] **Fix**
- **Workflow:** Fluxo 2
- **Node:** `Call 'generic-buffer'1`
- **Problema:** Node disabled mas é único caminho de `Está Pausado?` saída 1 → `Informações Medico Celcoin`. Sem buffer = 5 mensagens rápidas = 5 chamadas paralelas ao Fluxo 3 = 5 respostas IA paralelas = caos.
- **Solução (escolher 1):**
  - **(a) Reativar buffer:** habilitar node, configurar workflow `generic-buffer` (ID `VmVDvPPo605EmxW9`) com debounce 8-10s.
  - **(b) Remover totalmente:** conectar `Está Pausado?` saída 1 direto a `Informações Medico Celcoin`. Aceitar risco de mensagens paralelas.

### P2-26. Fluxo 3 — Switch fallback "extra" sem conexão
- [ ] **Fix**
- **Workflow:** Fluxo 3
- **Node:** `Switch por Intent1`
- **Problema:** `fallbackOutput: "extra"` mas sem conexão. Intent fora de QUESTION/CONFIRMATION/TRANSFER_HUMAN/REJECTION = drop silencioso. Médico sem resposta.
- **Solução:**
  1. Conectar fallback (5ª saída) a `meta enviar texto3` (TRANSFER) por default.
  2. Adicionar Code node antes: log alerta com intent recebida em `operation_logs`.

### P2-27. Fluxo 3 — `Edit Fields` popula campos doctor_* sempre vazios
- [ ] **Fix**
- **Workflow:** Fluxo 3
- **Node:** `Edit Fields`
- **Problema:** Campos `doctor_id`, `doctor_name`, `doctor_cpf`, etc puxam `$json.doctor_id` etc, mas trigger só recebe `{phone, instancia, mensagem}`. Tudo undefined. Causa direta de #P0-8.
- **Solução:**
  1. Antes do Edit Fields, adicionar Supabase node `Buscar Doctor por Phone` (como em P0-8).
  2. Mapear campos em Edit Fields a partir desse lookup:
     - `doctor_id`: `={{ $('Buscar Doctor por Phone').first().json.id }}`
     - `doctor_name`: `={{ $('Buscar Doctor por Phone').first().json.full_name }}`
     - etc.
  3. Se doctor não existir, criar/upsert primeiro (cobre caso novo médico inicia contato).

### P2-28. Fluxo 3 — Memória Postgres v1.3 sem TTL/poda
- [ ] **Fix**
- **Workflow:** Fluxo 3
- **Node:** `Postgres Chat Memory`
- **Problema:** Memória cresce indefinidamente por phone. Latency OpenAI sobe (mais tokens).
- **Solução:**
  1. Atualizar typeVersion 1.3 → 1.4.
  2. Configurar `contextWindowLength: 30` (default 5 muito pouco, atuais legacy 150 muito).
  3. Criar job de poda mensal (cron workflow separado):
     ```sql
     DELETE FROM n8n_chat_histories WHERE created_at < NOW() - INTERVAL '60 days';
     ```

### P2-29. Fluxo 4 — Long linear chain 22 nodes
- [ ] **Fix**
- **Workflow:** Fluxo 4
- **Problema:** 22 nodes lineares = difícil testar, debug, e reutilizar lógica.
- **Solução (refactor opcional):** quebrar em 3 sub-workflows:
  - `fluxo-4a-gerar-pdf`: Drive + Docs (Criar Pasta → Baixar PDF).
  - `fluxo-4b-clicksign-signer`: upload + signer + vincular + notificar.
  - `fluxo-4c-persistir-notificar`: Supabase + Meta + ClickSign notificação.
  - Fluxo 4 vira orquestrador que chama 4a → 4b → 4c.

### P2-30. Fluxo 4 — `Hospital: ""` hardcoded
- [ ] **Fix**
- **Workflow:** Fluxo 4
- **Node:** `Informações Medico Celcoin` (Set)
- **Problema:** Field name é `=Hospital` (com `=` literal no nome — typo) e value vazio.
- **Solução:**
  1. Renomear field para `Hospital` (sem `=`).
  2. Value: `={{ $('Pegar Informações de antecipação').item.json['Hospital'] }}` ou puxar de coluna real do Sheets.

### P2-31. Fluxo 4 — 4 nodes desconectados (legacy)
- [ ] **Fix**
- **Workflow:** Fluxo 4
- **Nodes:** `HTTP Request`, `Autenticação1`, `HTTP Request1`, `Autenticação2`
- **Problema:** Spec linha 399 já lista como pendência.
- **Solução:** deletar os 4 nodes via `removeNode` (não há conexões).

### P2-32. Fluxo 5 — `Aguardar Rendering` Wait 30s fixo
- [ ] **Fix**
- **Workflow:** Fluxo 5
- **Node:** `Aguardar Rendering`
- **Problema:** Celcoin pode demorar mais em carga. Wait fixo é frágil.
- **Solução:** substituir por loop polling:
  1. Code node `Verificar Rendering`: chama GET `/applications/{id}/signatures`.
  2. IF `collect_sign_link` existe → continua. Senão → Wait 5s → loop max 6 tentativas.
  3. Após 6 falhas → Stop and Error com log.

### P2-33. Fluxo 5 — `Log Operação` sem `doctor_id`
- [ ] **Fix**
- **Workflow:** Fluxo 5
- **Node:** `Log Operação`
- **Problema:** Insert sem FK `doctor_id` = log órfão.
- **Solução:** adicionar field:
  - `doctor_id`: `={{ $('Buscar medico Supabase').first().json.id }}`

### P2-34. Fluxo 6 — `clicksign_status` armazena `'running'` mesmo após assinar
- [ ] **Fix**
- **Workflow:** Fluxo 6
- **Node:** `Extrair Dados ClickSign`
- **Problema:** Payload real: `document.status='running'` (= documento aberto, esperando outros signers). Workflow grava esse status mas marca `status='signed'`. Inconsistência.
- **Solução:** trocar lógica no Code:
  ```js
  const status = event.name === 'sign' ? 'signed' : (docData.status || 'unknown');
  const signedAt = signer.signed_at || event.occurred_at || new Date().toISOString();
  ```

### P2-35. Tabela `conversations` existe mas não é populada
- [ ] **Fix (decisão)**
- **Schema:** Supabase `public.conversations` (doctor_id, whatsapp_number, direction, message_type, content, intent, handled_by, metadata). 0 rows.
- **Problema:** Spec não menciona. Existe órfã.
- **Solução (escolher):**
  - **(a) Popular:** Fluxo 3 insere cada mensagem inbound + outbound. Audit completo + analytics.
  - **(b) Drop:** se Postgres Chat Memory já cobre, deletar tabela.
  - Recomendado (a) — Chat Memory é só pra contexto IA, não audit.

### P2-36. Fluxo 6 — `Acionar Fluxo 5` typeVersion 1 (latest 1.3) sem mapeamento explícito
- [ ] **Fix**
- **Workflow:** Fluxo 6
- **Node:** `Acionar Fluxo 5`
- **Solução:**
  1. Upgrade typeVersion 1 → 1.3.
  2. Mapear `workflowInputs` explícitos:
     ```json
     {
       "mappingMode": "defineBelow",
       "value": { "phone": "={{ $json.phone }}" }
     }
     ```

### P2-37. Phone normalization global
- [ ] **Fix** — duplicado de P1-15. Marcar lá quando concluir.

---

## 🟢 P3 — BAIXO (boas práticas, warnings de validator)

### P3-38. TypeVersions outdated (todos os fluxos)
- [ ] **Fix**
- **Lista:**
  - Schedule Trigger 1.2 → 1.3 (Fluxo 1)
  - Google Sheets 4.5 → 4.7 (Fluxos 1, 5)
  - Filter 2.2 → 2.3 (Fluxo 1)
  - AI Agent 3 → 3.1 (Fluxo 3)
  - HTTP Request 4.2 → 4.4 (Fluxos 4, 5)
  - Postgres Memory 1.3 → 1.4 (Fluxos 2, 3)
  - IF 2.2 → 2.3 (Fluxo 5)
  - Execute Workflow 1 → 1.3 (Fluxo 6)
  - ClickSign nodes HTTP 4.2 → 4.4 (Fluxo 4)
- **Solução:** usar `n8n_autofix_workflow` com `fixTypes: ["typeversion-upgrade"]` e `confidenceThreshold: "high"`. Revisar postUpdateGuidance.

### P3-39. `onError` ausente em ~40 nodes HTTP/DB
- [ ] **Fix**
- **Solução:** definir política:
  - **Crítico (auth, persistência core):** `retryOnFail: true, maxTries: 3, waitBetweenTries: 3000`.
  - **Não-crítico (notificação, log):** `onError: 'continueRegularOutput'`.
  - Aplicar via patch em todos os HTTP/Supabase/Postgres/Sheets nodes.

### P3-40. Code nodes usam `this.helpers` (validator quer `$helpers`)
- [ ] **Fix**
- **Nodes:** `Verificar Medicos`, `Atualizar Ou inserir Medicos` (Fluxo 1), `Clicksign criar arquivo` (Fluxo 4)
- **Status:** Funciona ambos em runtime. Cosmético.
- **Solução:** trocar `this.helpers.httpRequest` por `$helpers.httpRequest` (segue convenção mais nova).

### P3-41. Template literals `${}` em JSON.stringify (false positives)
- [ ] **Fix (não-fix)**
- **Status:** Validator erra. Funciona fine porque está dentro de `JSON.stringify({...})` que é JS válido.
- **Ação:** ignorar warnings. Documentar em CLAUDE.md se necessário.

### P3-42. `Refinar Mensagem IA` modo "Run Once for All Items"
- [ ] **Fix**
- **Workflow:** Fluxo 3
- **Node:** `Refinar Mensagem IA`
- **Problema:** Acessa `$json` em modo all-items. Funciona com 1 item, quebra em batch.
- **Solução:** trocar `mode: "runOnceForAllItems"` → `mode: "runOnceForEachItem"`. Validar lógica continua correta.

### P3-43. Sticky notes desatualizadas
- [ ] **Fix**
- **Locais:** Fluxo 2 (menciona Evolution API), Fluxo 3 (menciona criar tabela `conversations` que já existe)
- **Solução:** atualizar conteúdo dos sticky notes para refletir estado real.

### P3-44. Cron 8h em timezone `America/New_York`
- [ ] **Fix (confirmar)**
- **Workflow:** Fluxo 1
- **Problema:** PinData confirma timezone NY. Médicos BR (BRT/UTC-3) recebem às 9h-10h.
- **Solução:** confirmar com Lucas se intencional. Se não, mudar timezone do n8n para `America/Sao_Paulo` ou ajustar cron pra 11h NY.

---

## 📋 Pendências Spec.md (atualizar documentação)

### SPEC-1. Documentar Chatwoot como middleware
- [ ] **Fix**
- Adicionar seção "Integrações Externas" descrevendo Chatwoot. URL: `automacao-medflow-chatwoot.zhe0xi.easypanel.host`. Account ID: 2. Inbox: "Whatsapp API OFICIAL".

### SPEC-2. Documentar tabela `conversations` no Supabase
- [ ] **Fix**
- Adicionar à seção "Arquitetura de Dados → Supabase".

### SPEC-3. Documentar colunas extras `contracts_ccb.hospital`, `contracts_*.assinado`
- [ ] **Fix**
- `hospital text` em ambas as tabelas de contrato.
- `assinado boolean default false` — duplica `status='signed'`. Decidir manter ambos ou dropar.

### SPEC-4. Documentar tabela `system_config`
- [ ] **Fix**
- 6 rows existentes. Schema: `key varchar PK, value jsonb, description text, updated_at timestamptz`.

### SPEC-5. Corrigir item REJECTION nas Pendências
- [ ] **Fix**
- Trocar `[ ] Fluxo 3 REJECTION branch` (l.397) para `[x]` após P0-8 fixado.

### SPEC-6. Atualizar Fluxo 2 — Verificar Pause Redis presente
- [ ] **Fix**
- Reescrever linha 101 confirmando que Verificar Pause + Está Pausado existem.

### SPEC-7. Corrigir taxa
- [ ] **Fix**
- Confirmar taxa real (3,5% ou 7%) com Lucas. Documentar fonte da verdade (env var ou `system_config`).

---

## 🎯 Quick Wins — Ordem Recomendada de Execução

Sequência sugerida pra atacar primeiro (impacto máximo / risco mínimo):

1. [ ] **P0-5** Filter `APPLICATION_SIGNED` no Fluxo 6 (evita celebração premature) — 5 min
2. [ ] **P0-4** Trocar HTTP por Supabase node no Fluxo 2 (segurança + bug) — 15 min
3. [ ] **P0-3** Token ClickSign em env var (segurança) — 10 min
4. [ ] **P0-1 + P0-2** Env vars Celcoin + interest_rate (correção financeira) — 10 min
5. [ ] **P0-8 + P2-27** Popular doctor_id no Edit Fields Fluxo 3 (destrava REJECTION) — 20 min
6. [ ] **P0-9 + P1-15** Padronizar phone format global (destrava CCB lookup) — 1h
7. [X] **P0-6** Fluxo 6 update CCB filtrar por `celcoin_operation_id` — 5 min
8. [ ] **P0-7 + P1-21** Fluxo 1 dedupe + populate `receivables` — 30 min
9. [ ] **P1-16 + P1-17** Fluxo 4 completar placeholders + KYC habilitado — 30 min
10. [ ] **P1-22** HMAC validation nos 3 webhooks + response 200 — 1h

**Total estimado quick wins:** ~4-5h de trabalho focado.

---

## 📊 Resumo Numérico

| Prioridade | Quantidade | Estimativa Total |
|---|---|---|
| P0 (crítico) | 10 | 4-6h |
| P1 (alto) | 12 | 6-10h |
| P2 (médio) | 15 | 8-12h |
| P3 (baixo) | 7 | 2-4h |
| Spec docs | 7 | 1-2h |
| **TOTAL** | **51** | **21-34h** |

---

*Gerado: 2026-05-25. Baseado em snapshot dos 6 workflows + schema Supabase + validation runtime profile.*
