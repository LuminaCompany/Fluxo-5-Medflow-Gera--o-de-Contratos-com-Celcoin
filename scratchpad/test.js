// Suite do "Refinar Mensagem IA" (Fluxo 3).
// Rodar: node test.js refinar.js

const path = require('path');
const alvo = process.argv[2] || 'refinar.js';
const refinar = require(path.resolve(__dirname, alvo));

const UUID = 'a1b2c3d4-e5f6-4789-8abc-def012345678';

// --- helpers de contexto -----------------------------------------------
function passoTool(observation) {
  return {
    action: { tool: 'consultar_medflow', toolInput: { cpf: '05219363140' } },
    observation: typeof observation === 'string' ? observation : JSON.stringify(observation)
  };
}

function saidaIA(obj) {
  return JSON.stringify(obj);
}

function ctx(over) {
  return Object.assign({
    phone: '556198430401',
    user_message: 'bom dia',
    doctor_id: '1087bcdf-0986-4e7f-86d5-5f98a9922bd5',
    doctor_name: 'Lucas Rezende de Brito',
    doctor_cpf: '05219363140',
    doctor_email: 'lucas@exemplo.com'
  }, over || {});
}

function rodar(output, passos, ctxOver, triggerOver) {
  const nodes = {
    'Edit Fields': ctx(ctxOver),
    'When Executed by Another Workflow': Object.assign(
      { phone: '556198430401', mensagem: 'bom dia', instancia: '17' }, triggerOver || {}
    )
  };
  return refinar({ output: output, intermediateSteps: passos || [] }, nodes)[0].json;
}

// --- suite -------------------------------------------------------------
const casos = [];
function teste(nome, fn) { casos.push({ nome: nome, fn: fn }); }

function eq(atual, esperado, campo) {
  if (atual !== esperado) {
    throw new Error(campo + ': esperado ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(atual));
  }
}
function contem(str, trecho, campo) {
  if (String(str).indexOf(trecho) === -1) {
    throw new Error(campo + ': esperado conter ' + JSON.stringify(trecho) + ', veio ' + JSON.stringify(str));
  }
}

// 1. Regressao da execucao 178747: sub-workflow despublicado.
teste('sub-workflow fora do ar NAO transfere (nao pausa 72h)', function () {
  const r = rodar(
    saidaIA({ response: 'Vou te passar pra um atendente.', intent: 'TRANSFER_HUMAN', confidence: 1.0 }),
    [passoTool([{ error: 'Workflow is not active and cannot be executed.' }])],
    { user_message: '05219363140' },
    { mensagem: '05219363140' }
  );
  eq(r.intent, 'QUESTION', 'intent');
  eq(r.medflow_consultada, true, 'medflow_consultada');
  eq(r.medflow_auth_ok, false, 'medflow_auth_ok');
  eq(r.medflow_auth_error, 'tool_indisponivel', 'medflow_auth_error');
  contem(r.guard_reasons, 'transfer_por_falha_medflow_rebaixado:infra', 'guard_reasons');
  contem(r.ai_response, 'CPF', 'ai_response');
});

// 2. O medico pediu humano de verdade: transferencia tem que sobreviver.
teste('medico pediu atendente: transfere mesmo com MedFlow caida', function () {
  const r = rodar(
    saidaIA({ response: 'Claro, vou te transferir.', intent: 'TRANSFER_HUMAN', confidence: 1.0 }),
    [passoTool([{ error: 'Workflow is not active and cannot be executed.' }])],
    { user_message: 'quero falar com um atendente' },
    { mensagem: 'quero falar com um atendente' }
  );
  eq(r.intent, 'TRANSFER_HUMAN', 'intent');
});

// 3. auth_error de CPF vira pedido de CPF, nao transferencia.
teste('verification_failed pede o CPF de novo', function () {
  const r = rodar(
    saidaIA({ response: 'Vou te transferir.', intent: 'TRANSFER_HUMAN', confidence: 1.0 }),
    [passoTool({ auth_ok: false, auth_error: 'verification_failed' })],
    { user_message: '11122233344' },
    { mensagem: '11122233344' }
  );
  eq(r.intent, 'QUESTION', 'intent');
  eq(r.medflow_auth_error, 'verification_failed', 'medflow_auth_error');
  contem(r.ai_response, 'localizar esse CPF', 'ai_response');
  contem(r.guard_reasons, 'transfer_por_falha_medflow_rebaixado:verification_failed', 'guard_reasons');
});

// 4. MedFlow viva: TRANSFER_HUMAN da IA passa intacto.
teste('MedFlow viva: TRANSFER_HUMAN passa', function () {
  const r = rodar(
    saidaIA({ response: 'Vou te passar pra um atendente.', intent: 'TRANSFER_HUMAN', confidence: 1.0 }),
    [passoTool({ auth_ok: true, antecipacoes: [], historico: [] })]
  );
  eq(r.intent, 'TRANSFER_HUMAN', 'intent');
  eq(r.medflow_auth_ok, true, 'medflow_auth_ok');
});

// 5. Comportamento documentado preservado: consulta rodou e falhou + CONFIRMATION -> humano.
teste('CONFIRMATION com consulta falha ainda vai pra humano', function () {
  const r = rodar(
    saidaIA({ response: 'Confirmado!', intent: 'CONFIRMATION', confidence: 0.9, plantao_id: UUID }),
    [passoTool({ auth_ok: false, auth_error: 'user_not_found' })]
  );
  eq(r.intent, 'TRANSFER_HUMAN', 'intent');
  contem(r.guard_reasons, 'confirmation_sem_medflow:user_not_found', 'guard_reasons');
});

// 6. CONFIRMATION sem tool chamada = erro da IA -> reconfirma.
teste('CONFIRMATION sem consulta vira QUESTION', function () {
  const r = rodar(
    saidaIA({ response: 'Confirmado!', intent: 'CONFIRMATION', confidence: 0.9, plantao_id: UUID }),
    []
  );
  eq(r.intent, 'QUESTION', 'intent');
  contem(r.guard_reasons, 'confirmation_sem_consulta', 'guard_reasons');
});

// 7. Caminho feliz do contrato.
teste('CONFIRMATION valida dispara contrato', function () {
  const r = rodar(
    saidaIA({ response: 'Perfeito, vou emitir agora.', intent: 'CONFIRMATION', confidence: 0.95, plantao_id: UUID }),
    [passoTool({ auth_ok: true, antecipacoes: [{ id: UUID }] })]
  );
  eq(r.intent, 'CONFIRMATION', 'intent');
  eq(r.plantao_id, UUID, 'plantao_id');
  eq(r.guard_reasons, '', 'guard_reasons');
});

// 8. Anti-eco de CPF.
teste('CPF na resposta e mascarado', function () {
  const r = rodar(
    saidaIA({ response: 'Confirmei o CPF 052.193.631-40 aqui.', intent: 'QUESTION', confidence: 0.9 }),
    [passoTool({ auth_ok: true })]
  );
  contem(r.guard_reasons, 'cpf_ecoado_mascarado', 'guard_reasons');
  if (/\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[.\s-]?\d{2}/.test(r.ai_response)) {
    throw new Error('ai_response ainda tem CPF: ' + r.ai_response);
  }
});

// 9. Valor em R$ sem MedFlow = alucinacao.
teste('valor em R$ sem MedFlow vira QUESTION sem valor', function () {
  const r = rodar(
    saidaIA({ response: 'Você tem R$ 5.000,00 disponíveis.', intent: 'QUESTION', confidence: 0.9 }),
    [passoTool([{ error: 'Workflow is not active and cannot be executed.' }])]
  );
  eq(r.intent, 'QUESTION', 'intent');
  contem(r.guard_reasons, 'valor_sem_medflow', 'guard_reasons');
  if (/R\$/.test(r.ai_response)) throw new Error('vazou valor: ' + r.ai_response);
});

// 10. Saida nao estruturada nunca dispara contrato.
teste('texto puro vira QUESTION', function () {
  const r = rodar('Oi doutor, tudo bem?', [passoTool({ auth_ok: true })]);
  eq(r.intent, 'QUESTION', 'intent');
  contem(r.guard_reasons, 'saida_nao_estruturada', 'guard_reasons');
});

// 11. Array vazio da tool nao vira "infra" fantasma.
teste('tool sem observacao util = medflow_nao_consultada', function () {
  const r = rodar(saidaIA({ response: 'Oi!', intent: 'QUESTION', confidence: 0.9 }), []);
  eq(r.medflow_consultada, false, 'medflow_consultada');
  contem(r.guard_reasons, 'medflow_nao_consultada', 'guard_reasons');
  eq(r.medflow_auth_error, '', 'medflow_auth_error');
});

// --- runner ------------------------------------------------------------
let ok = 0, falhou = 0;
casos.forEach(function (c, i) {
  try {
    c.fn();
    ok++;
    console.log('  ok   ' + (i + 1) + '. ' + c.nome);
  } catch (e) {
    falhou++;
    console.log('  FAIL ' + (i + 1) + '. ' + c.nome);
    console.log('       ' + e.message);
  }
});
console.log('\n' + ok + ' passaram, ' + falhou + ' falharam (' + casos.length + ' casos)');
process.exit(falhou ? 1 : 0);
