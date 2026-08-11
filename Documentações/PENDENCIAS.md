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

### P0-45. Fluxo 3 — env vars da MedFlow não existem, node de auth falha
- [X] **Fix** — resolvido em 2026-08-10 (env vars criadas, verificado em execução real: `has_client_id: true`, `client_id_len: 20`, `client_secret_len: 43`, token emitido com sucesso)
- **Workflow:** Fluxo 3 (`FX6bv7g3sxAkjfhj`)
- **Node:** `Autenticar MedFlow` (HTTP Request)
- **Origem:** troca da tool Google Sheets pelas tools da API MedFlow (2026-08-07).
- **Problema:** o header é `=Basic {{ ($env.MEDFLOW_CLIENT_ID + ':' + $env.MEDFLOW_CLIENT_SECRET).base64Encode() }}`. Nenhuma das duas env vars existe no n8n hoje. Sem elas o Basic vai vazio → `401 invalid_client` → `access_token` undefined → `antecipacoes_disponiveis` e `status_antecipacoes` tomam 401 → a Ana perde TODA a fonte de dados de plantão.
- **Solução:**
  1. Criar no EasyPanel (serviço do n8n) e reiniciar o container:
     ```
     MEDFLOW_CLIENT_ID=mfc_41758b7b43f45c67
     MEDFLOW_CLIENT_SECRET=<client_secret da MedFlow>
     ```
  2. Validar com um médico real: executar o Fluxo 3 e conferir que `Autenticar MedFlow` retorna `access_token`, `aud: chat-automation`, `expires_in: 900`.
  3. O node está com `onError: continueRegularOutput` — ele NÃO derruba o fluxo quando falha, só devolve resposta vazia. Confirmar que o prompt cai em `TRANSFER_HUMAN` nesse caso (regra "Falha de ferramenta" já está no system message).

### P0-46. Fluxo 3 — write-back da planilha parou de casar (plantao_id virou UUID)
- [ ] **Fix**
- **Workflow:** Fluxo 3
- **Nodes:** `Atualizar Status (Gerando Termos de Serviço)`, `Marcar Fila` (ambos Google Sheets, `operation: update`)
- **Origem:** troca da tool Google Sheets pelas tools da API MedFlow (2026-08-07).
- **Problema:** os dois nodes casam a linha por `matchingColumns: ["ID"]` com `ID = {{ $json.plantao_id }}`. O `plantao_id` agora vem de `entries[].id` da MedFlow (UUID), não mais da coluna `ID` da planilha. **Nenhum update casa** → a linha nunca sai de `Aviso de valor disponível enviado` e nunca vira `Na fila`.
  - **Efeito em cascata (o pior):** o dedupe do Fluxo 1 (#P0-7) filtra por `STATUS`. Como o STATUS não avança mais, **o médico volta a receber a oferta todo dia**, inclusive com contrato já em assinatura.
  - `Atualizar Status` (Rejeitou) casa por `phone` — esse continua funcionando.
- **Solução (escolher 1):**
  - **(a) Correlacionar IDs (recomendado):** criar coluna `entry_id` na planilha e o Fluxo 1 gravar nela o `entries[].id` da MedFlow ao popular a linha. Depois trocar `matchingColumns` dos dois nodes para `["entry_id"]`.
  - **(b) Migrar o estado pro Supabase:** parar de usar a planilha como máquina de estado; gravar o progresso em `receivables.status` (tabela já existe, ver #P1-21) casando por `entry_id`. Fluxo 1 e Fluxo 4 passam a ler de lá.
  - **(c) Estado só na MedFlow:** dropar os dois nodes e derivar tudo de `blocked_reason: loan` (receivables) + `loans.status`. Mais limpo, mas exige mexer no dedupe do Fluxo 1 e no Fluxo 4 antes.

### P0-47. Fluxo 4 lê valor da planilha enquanto a Ana mostra valor da API
- [X] **Fix** — resolvido em 2026-08-10. Escopo ampliado: **Fluxo 4 e Fluxo 5 passaram a ler TODA informação da API MedFlow, com o CPF do médico como chave.**
- **Workflows:** Fluxo 4 (`UBxeuuB9tt9Osfs3`), Fluxo 5 (`wqyQKymnaXLTFazA`), + repasse de CPF no Fluxo 3 (`FX6bv7g3sxAkjfhj`) e Fluxo 6 (`kr8Ou1tefMyzEDnB`)
- **Problema (original):** a Ana citava `available_amount` / `simulation.net_amount` vindos de `GET /protected/receivables`, mas o contrato de Termos era montado com o `Valor Disponível` da planilha. Se os dois divergissem (taxa diferente, IOF, margem liberada, planilha desatualizada), **o médico assinaria um valor diferente do que viu no WhatsApp**. Risco jurídico, não só de UX. O Fluxo 5 tinha o mesmo problema no valor da CCB.

- **O que foi feito — bloco MedFlow idêntico nos dois fluxos:**
  ```
  <trigger> → Identidade Supabase → Resolver Identidade → Autenticar MedFlow
            → Perfil MedFlow → <IF perfil ok?> → Antecipações MedFlow → <Somar>
  ```
  - `Identidade Supabase` (Supabase `doctors`, `matchType: anyFilter` por `cpf` **ou** `whatsapp`, `alwaysOutputData`): serve **só** para resolver identidade — devolve `doctors.id` (FK dos inserts) e o CPF de cadastro quando o chamador não mandou. Nenhum valor de antecipação sai daí.
  - `Resolver Identidade` (Code): `cpf = digits(input.cpf) || digits(doctors.cpf)`, `phone = digits(input.phone) || digits(doctors.whatsapp)`. Lança erro explícito se faltar CPF ou telefone. Também expõe `cpf_mascarado` (`413******03`) para mensagens de erro — CPF cru nunca vai para log.
  - `Autenticar MedFlow`: `POST /service/token`, Basic `MEDFLOW_CLIENT_ID:MEDFLOW_CLIENT_SECRET`, body `{cpf, phone}`, `Accept: application/json`, `onError: continueRegularOutput` + `retryOnFail`.
  - `Perfil MedFlow`: `GET /protected/profile` → nome, e-mail, CPF, CRM/UF, nascimento e endereço estruturado (`street/number/complement/neighborhood/city/state/postal_code`).
  - `Antecipações MedFlow`: `GET /protected/receivables?dashboard=true` — **exatamente a mesma chamada que a tool `antecipacoes_disponiveis` da Ana faz**.
  - Headers `Authorization: Bearer` + `JWT-AUD: chat-automation` + `Accept: application/json` em todo `/protected/*`.

- **Fluxo 4 — o que mudou:**
  - **Removidos:** `Pegar Informações de antecipação`, `Split IDs Termos`, `Buscar Valores Termos` (os 3 Google Sheets) e `Autenticação` + `Buscar medico pelo CPF` (Celcoin `GET /persons`). O Fluxo 4 **não fala mais com a Celcoin nem com a planilha** para obter dados.
  - `Somar Termos` reescrito: indexa `data[].attributes.entries[]` por `id` (UUID), casa com os `plantao_ids` recebidos, **aborta** se algum vier `blocked` / sem `simulation` / ausente (evita assinar valor diferente do combinado), e soma `available_amount`, `simulation.net_amount`, `interest` e `iof`. Também devolve `hospital` (`company.group_name`), `competencia` (safra) e `payment_date`.
  - `Medico Encontrado?` agora testa `access_token && data.attributes` do MedFlow; ramo false vai para o novo `Abortar Sem MedFlow` (Stop and Error com CPF mascarado) em vez de morrer em silêncio.
  - `Informações Medico Celcoin` (nome mantido para não quebrar as 5 referências downstream) passou a ler tudo do `Perfil MedFlow`. Campos novos: `CEP`, `Cidade`, `UF`. Campo `=Hospital` (typo, ver #P2-30) virou `Hospital` alimentado pela API.
  - `Editar Contrato`: `{CEP}`, `{Cidade}` e `{UF}` deixaram de ser placeholders vazios (resolve parte do #P1-16). `{Número do RG}` e `{Órgão Emissor do RG}` continuam sem fonte — a MedFlow não expõe RG.
  - `Criar Pasta` usava `{{ $json.Cliente }}`, campo que não existia mais → pasta saía com nome vazio. Agora usa `{{ $json.Nome }}`.
  - `Buscar medico` (FK) e `Salvar Contrato Termos Supabase` agora casam por `id`/`cpf` resolvidos e gravam os `plantao_ids` **efetivamente contratados** (saída do `Somar Termos`), não os brutos do input.

- **Fluxo 5 — o que mudou:**
  - **Removidos:** `Buscar Médico Google Sheets`, `Split IDs CCB`, `Buscar Valores CCB`.
  - `Somar CCB` reescrito igual ao `Somar Termos` (mesmas travas de divergência).
  - `Médico Encontrado na tabela?` foi repurposado para checar o perfil MedFlow; `Medico Encontrado?` (Celcoin) ganhou ramo false → `Stop and Error`.
  - `Buscar medico pelo CPF` (Celcoin) continua — é a **única** coisa que ainda vem da Celcoin, porque `borrower.id` só existe lá. O CPF da query agora vem do `Resolver Identidade`, não da planilha.
  - `Preparar Solicitação`: nome/e-mail/telefone vêm do `Perfil MedFlow`, valor vem do `Somar CCB`; da Celcoin só o `person_id`.
  - `meta enviar texto` não referencia mais `Buscar Médico Google Sheets` (node deletado) — usa `Extrair Application ID`.
  - `Buscar medico Supabase` / `Salvar Contrato Supabase`: mesma correção de FK e de `plantao_ids` do Fluxo 4.

- **Repasse do CPF:**
  - Fluxo 3 → `Call 'Fluxo 4 ...'` ganhou o input `cpf` = `{{ $('Edit Fields').item.json.doctor_cpf }}`.
  - Fluxo 6 → `Preparar Dados Fluxo 5` agora emite `cpf` (e normaliza o phone); o trigger `Fluxo Anterior` do Fluxo 5 declara `cpf` e `instancia` (esta última nunca chegava antes, apesar de o `Preparar Solicitação` lê-la).
  - Se o `cpf` não vier, os dois fluxos caem no `doctors.cpf` do Supabase; se nem isso existir, erram com mensagem explícita.

- **Aberto / a validar em produção:**
  - `{estado civil}` no contrato ainda é preenchido pelo campo `Nacionalidade` (agora vazio) — a MedFlow não expõe nem estado civil nem nacionalidade. Ver #P1-16.
  - Vale para os dois fluxos o #P0-50: médico sem cadastro na MedFlow agora **aborta com erro visível** em vez de gerar contrato com dado de planilha.
  - `valor_total` (o que vai no contrato) = soma de `available_amount`, equivalente direto da coluna `Valor Disponível`. `valor_liquido` (net após juros+IOF) também fica disponível no output caso o contrato precise citar os dois — decidir com o jurídico qual dos dois o `{valor_total}` deve mostrar.

### P0-50. Maioria dos médicos do Supabase não tem cadastro na MedFlow → Ana fica cega
- [ ] **Fix**
- **Origem:** smoke test de 2026-08-10 contra a API de produção (`app.medflowfin.com`).
- **Problema:** dos 4 médicos com CPF na tabela `doctors`, **só 1 tem conta na MedFlow**. Os outros 3 devolvem `404 user_not_found` no `POST /service/token`. Sem token, `antecipacoes_disponiveis` e `status_antecipacoes` não retornam nada e a Ana cai em `TRANSFER_HUMAN` — ou seja, **para 75% da base o atendimento automático simplesmente não funciona**.
  - Resultado do teste (CPFs mascarados): `462***13` Rafael Coelho → **201 OK**, 1 grupo / 4 plantões, hospital AMA, competência 6/2026. `052***40`, `413***03`, `437***70` → 404.
  - O erro traz `meta.required_fields: [name, email, phone, cpf, crm, crm_state, birthdate]` — a MedFlow diz quais campos faltam pra criar a conta.
- **Solução (escolher):**
  - **(a)** Fazer o onboarding em massa na MedFlow (`POST /users`) a partir do Supabase, antes de ligar o fluxo pra base toda.
  - **(b)** Tratar 404 explicitamente: em vez de `TRANSFER_HUMAN` genérico, a Ana responde que o cadastro precisa ser concluído e o fluxo dispara o link/onboarding. **Combina com #P1-52** (pedir o CPF ao médico antes de desistir — resolve o caso em que o CPF do Supabase é que está errado, não o cadastro na MedFlow).
  - **(c)** Restringir o disparo do Fluxo 1 só a médicos que já autenticam na MedFlow (checar antes de ofertar).
  - Verificar também se `doctors.whatsapp` bate com o telefone cadastrado na MedFlow — a verificação do token é por telefone (`verification_method: "phone"`), com fallback CRM+UF.

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

### P1-48. Fluxo 3 — `maxIterations: 3` ficou apertado com duas tools obrigatórias
- [ ] **Fix**
- **Workflow:** Fluxo 3 (`FX6bv7g3sxAkjfhj`)
- **Node:** `AI Agent — Ana Medflow1`
- **Origem:** troca da tool Google Sheets pelas tools da API MedFlow (2026-08-07).
- **Problema:** antes era 1 tool (`informacoes_do_medico`); agora o prompt manda chamar `antecipacoes_disponiveis` **e** `status_antecipacoes` (trava de sequência) antes de confirmar. Com `maxIterations: 3` sobra exatamente uma iteração pra resposta final — qualquer retry de tool, erro 401 ou chamada extra estoura o limite e o agent devolve resposta truncada ou vazia, que o `Refinar Mensagem IA` transforma em "Desculpe, houve um erro. Pode repetir?".
- **Solução:**
  1. Subir `maxIterations` para 6.
  2. Testar um caso de confirmação (2 tools + resumo + confirmação) e conferir nos logs quantas iterações realmente gasta.

### P1-51. Taxa: "7%" do discurso não bate com a simulação real da MedFlow (~4,5%)
- [ ] **Fix (decisão de negócio)**
- **Origem:** smoke test de 2026-08-10, dados reais do médico Rafael Coelho.
- **Problema:** números reais de um plantão de R$ 1.500,00 — `simulation.interest` R$ 60,84 + `simulation.iof` R$ 6,53 = **R$ 67,37 de desconto (4,49%)**, `net_amount` R$ 1.432,63. Um loan já criado mostra `fee_amount` R$ 67,09 + `iof_amount` R$ 6,86 sobre R$ 1.500 (4,93%). O prompt da Ana afirmava **"7% do valor total"** — ela diria 7% e mostraria número de 4,5% na mesma conversa.
- **Já mitigado:** o prompt foi alterado em 2026-08-10 para **derivar a taxa da `simulation`** do plantão (desconto = `available_amount` − `simulation.net_amount`) em vez de citar percentual fixo. A Ana não contradiz mais o valor exibido.
- **Falta decidir/alinhar:** qual é a taxa oficial da MedFlow e onde ela é fonte da verdade. Hoje há três números divergentes no sistema:
  - prompt da Ana: era 7% (agora derivado)
  - Fluxo 5, `Solicitar Empréstimo (CCB)`: `interest_rate: 0.07` hardcoded (ver #P0-1, que cita spec de 3,5%)
  - API MedFlow: ~4,5% efetivo na simulação
- **Solução:** confirmar a taxa correta com o financeiro, alinhar #P0-1, e definir se a CCB da Celcoin deve usar a mesma taxa que a MedFlow simula (senão o médico assina CCB com taxa diferente da que aceitou).

### P1-52. Fluxo 3 — Ana pedir o CPF ao médico e usá-lo como parâmetro na consulta
- [ ] **Fix**
- **Workflow:** Fluxo 3 (`FX6bv7g3sxAkjfhj`)
- **Nodes:** `Autenticar MedFlow`, `antecipacoes_disponiveis`, `status_antecipacoes`, system message do `AI Agent — Ana Medflow1`
- **Objetivo:** quando o CPF do Supabase não resolve (`404 user_not_found`, CPF vazio, CPF errado ou divergente), a Ana pergunta o CPF ao médico na conversa e refaz a consulta com ele — em vez de transferir pra humano. Mitiga direto o #P0-50 (hoje 3 de 4 médicos ficam sem atendimento automático).

- **Restrição de arquitetura (ler antes de implementar):** as tools de hoje **não podem receber CPF como parâmetro**. Quem carrega a identidade do médico é o `access_token` — `GET /protected/receivables` e `GET /protected/loans` não têm filtro por CPF, devolvem sempre o dono do token. Passar CPF na query não faz nada. Para o CPF digitado valer, ele precisa entrar no `POST /service/token`, que roda **antes** do agent. Ou seja: não basta editar as duas HTTP Request Tools.

- **Solução recomendada — trocar as 2 HTTP tools por 1 Tool Workflow:**
  1. Criar sub-workflow `helper-medflow-consulta` com `executeWorkflowTrigger` recebendo `{ cpf, phone, crm, crm_state }`.
  2. Dentro dele: `POST /service/token` → se 201, chama `/protected/receivables?dashboard=true` + `/protected/loans` → devolve um objeto único já normalizado (grupos, entries, loans) **mais** um campo de diagnóstico (`auth_ok`, `auth_error`).
  3. No Fluxo 3, substituir `antecipacoes_disponiveis` e `status_antecipacoes` por um `toolWorkflow` apontando pra esse sub-workflow, com o CPF vindo de `$fromAI('cpf', 'CPF do médico, só dígitos; deixe vazio para usar o cadastro', 'string')` e **fallback pro CPF do Supabase quando a IA mandar vazio**.
  4. O `phone` **continua vindo do canal**, nunca do que o médico digita — o swagger é explícito: "NUNCA um número digitado pelo contato, do contrário não prova posse". É o telefone que prova a identidade (`verification_method: "phone"`); o CPF só diz *qual* cadastro procurar.
  5. Manter o `Autenticar MedFlow` atual como caminho feliz (evita uma chamada extra por mensagem) e usar o tool workflow como retentativa.

- **Alternativa mais barata (se não quiser sub-workflow):** manter as tools como estão e adicionar uma terceira HTTP Request Tool `autenticar_com_cpf` que faz o `POST /service/token` com `cpf` via `$fromAI`. Contra: o token que ela devolve não é acessível pelas outras duas tools de forma confiável (uma tool não lê a saída de outra), então na prática só serve pra *validar* se o CPF existe — a consulta em si continuaria falhando. Só vale se combinada com um `Wait`/segunda passada do agent.

- **Mudanças necessárias no system message:**
  - Hoje a seção **DADOS SENSÍVEIS** diz "Nunca peça, confirme, repita ou registre: CPF..." e "O sistema já identifica o médico automaticamente — você NUNCA precisa pedir CPF". Precisa virar uma **exceção controlada**: pedir CPF **só** quando a consulta falhar por identificação, uma única vez, com justificativa curta ("pra localizar seu cadastro").
  - Regras a manter: **nunca repetir o CPF de volta** na resposta, nunca confirmar dígitos, nunca pedir junto com dado bancário.
  - Se o CPF digitado também falhar (`404`), pedir **CRM + UF** (fallback oficial da API) antes de `TRANSFER_HUMAN`.
  - Tratar `409 identity_conflict` (CPF/CRM divergem de cadastro existente) como `TRANSFER_HUMAN` imediato — é caso de fraude ou cadastro duplicado, não de retentativa.
  - Limitar retentativa: no máximo 2 tentativas por conversa, senão vira `TRANSFER_HUMAN` (a API tem rate limit 429).

- **LGPD / segurança (não pular):**
  - O CPF digitado passa a existir no histórico do WhatsApp, no Chatwoot **e** na `Postgres Chat Memory` do agent. Definir se a memória guarda ou mascara — hoje guarda tudo.
  - Não gravar o CPF em `operation_logs` nem em nenhum log de node; se precisar auditar, gravar mascarado (`413******03`).
  - Risco de enumeração: alguém com um telefone qualquer tentando CPFs alheios. A API já barra (`verification_failed`, mais `429`), mas o limite de 2 tentativas por conversa é a nossa camada.

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
- [X] **Fix** — resolvido junto com o #P0-47: campo renomeado para `Hospital` e alimentado por `company.group_name` da MedFlow.
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

### P2-49. Fluxo 3 — `Refinar Mensagem IA` referencia node que não existe
- [ ] **Fix**
- **Workflow:** Fluxo 3 (`FX6bv7g3sxAkjfhj`)
- **Node:** `Refinar Mensagem IA` (Code)
- **Problema:** a rede de segurança que converte POSIÇÃO ("o 1", "o 2") em ID real lê `$('Montar Contexto Plantões').first().json.plantoes_json`. **Esse node não existe no workflow** — a chamada sempre lança, o `catch` zera `realIds` e a conversão nunca acontece. Se a IA mandar `plantao_id: "1"` em vez do ID real, o valor passa cru pra frente.
- **Agravado em 2026-08-07:** com a API MedFlow o ID virou UUID, então um `"1"` vazado é ainda mais visivelmente inválido (antes ao menos colidia com um ID numérico da planilha).
- **Solução (escolher 1):**
  - **(a)** Remover o bloco morto (`realIds` + o `.map` de conversão) e confiar no prompt, que já manda usar `entries[].id`.
  - **(b)** Reconstruir a rede: guardar a última lista de plantões retornada pela tool (Redis por phone, ou um Set node) e mapear posição→UUID a partir dela.
  - Recomendado (a) enquanto não houver quem popule o contexto — código morto que finge validar é pior que nenhum.

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

### SPEC-8. Spec desatualizada — Fluxo 3 não usa mais Google Sheets Tool
- [ ] **Fix (documentação)**
- **Arquivo:** `spec.md` (seção Fluxo 3, linhas ~111-125) e `CLAUDE.md`
- **Problema:** a spec descreve o Fluxo 3 com `Tool: Informações do Medico (Google Sheets Tool — leitura de dados reais)`. Desde 2026-08-07 são três nodes novos: `Autenticar MedFlow` (HTTP, entre o lookup Supabase e o `Edit Fields`), `antecipacoes_disponiveis` e `status_antecipacoes` (HTTP Request Tool). A tool do Sheets foi removida.
- **Solução:**
  1. Reescrever a sequência do Fluxo 3 na spec (20 → 22 nodes de caminho ativo).
  2. Adicionar a MedFlow API na seção "Integrações Externas": base `https://app.medflowfin.com/api/v1`, swagger em `/api-docs/v1/swagger.yml`, auth `POST /service/token` (Basic client_id:client_secret + `{cpf, phone}`) → JWT `aud=chat-automation`, TTL 900s, e o header obrigatório `JWT-AUD: chat-automation` em todo `/protected/*`.
  3. Adicionar `MEDFLOW_CLIENT_ID` e `MEDFLOW_CLIENT_SECRET` na tabela de env vars.
  4. Marcar que o host `medflow-hhrc.onrender.com` (citado no `Guia_API_MedFlow_Boas_Praticas.md` e no Postman collection) está **morto** — 404 em toda rota.

---

## 🎯 Quick Wins — Ordem Recomendada de Execução

Sequência sugerida pra atacar primeiro (impacto máximo / risco mínimo):

0. [ ] **P0-45** Criar env vars `MEDFLOW_CLIENT_ID` / `MEDFLOW_CLIENT_SECRET` + restart (**bloqueia o Fluxo 3 inteiro hoje**) — 5 min
0b. [ ] **P1-48** Subir `maxIterations` do agent para 6 — 2 min
0c. [ ] **P0-46** Correlacionar `entry_id` planilha↔MedFlow (destrava o dedupe do Fluxo 1) — 45 min
0d. [X] **P0-47** Fluxo 4 **e Fluxo 5** lendo tudo da MedFlow (CPF como chave) em vez da planilha/Celcoin — feito 2026-08-10

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
| P0 (crítico) | 13 | 5-8h |
| P1 (alto) | 15 | 8-13h |
| P2 (médio) | 16 | 8-12h |
| P3 (baixo) | 7 | 2-4h |
| Spec docs | 8 | 1-2h |
| **TOTAL** | **60** | **25-42h** |

---

*Gerado: 2026-05-25. Baseado em snapshot dos 6 workflows + schema Supabase + validation runtime profile.*

*Atualizado: 2026-08-07. Adicionados P0-45, P0-46, P0-47, P1-48, P2-49 e SPEC-8 — riscos abertos pela troca da tool Google Sheets pelas tools da API MedFlow no Fluxo 3. A numeração dos itens é sequencial global (continua de 44), não reinicia por prioridade.*

*Atualizado: 2026-08-10 (2ª rodada). **P0-47 fechado com escopo ampliado:** Fluxo 4 e Fluxo 5 passaram a coletar TODAS as informações na API MedFlow usando o CPF do médico como chave (`POST /service/token` → `GET /protected/profile` + `GET /protected/receivables?dashboard=true`). Saíram 6 nodes de Google Sheets e 2 de lookup Celcoin; sobrou da Celcoin apenas o `GET /persons` do Fluxo 5, que existe só para obter o `borrower.id`. Fluxo 3 e Fluxo 6 passaram a repassar o `cpf`. Fechado junto: #P2-30. Parcialmente endereçado: #P1-16 (CEP/Cidade/UF).*

*Atualizado: 2026-08-10. Smoke test contra a API de produção (`app.medflowfin.com`) com dados reais. P0-45 fechado (env vars criadas e verificadas). Adicionados P0-50 (só 1 de 4 médicos tem cadastro na MedFlow), P1-51 (taxa 7% não bate com a simulação real de ~4,5%) e P1-52 (Ana pedir CPF ao médico e usar na consulta). Corrigidos no mesmo dia, direto no workflow: header `Accept: application/json` nos 3 nodes MedFlow (sem ele, token inválido devolve HTML de login com HTTP 200 em vez de 401) e o shape JSON:API dos loans (`data[].attributes.status`, não `data[].status` como diz o swagger).*
