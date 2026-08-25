// Harness local do Code node "Refinar Mensagem IA" (Fluxo 3 - FX6bv7g3sxAkjfhj).
// Copia fiel do jsCode, embrulhada numa funcao que recebe $json e os nodes mockados.
// Rodar: node test.js refinar.js

module.exports = function refinar($json, nodes) {
  nodes = nodes || {};
  const $ = function (nome) {
    return { first: function () { return nodes[nome] ? { json: nodes[nome] } : null; } };
  };

// === Fluxo 3 - normalizacao DETERMINISTICA da saida da IA (v2) ===
const INTENTS_VALIDOS = ['QUESTION', 'CONFIRMATION', 'REJECTION', 'TRANSFER_HUMAN'];

const ALIAS_INTENT = {
  TRANSFER: 'TRANSFER_HUMAN', HUMAN: 'TRANSFER_HUMAN', HANDOFF: 'TRANSFER_HUMAN',
  ATENDENTE: 'TRANSFER_HUMAN', TRANSFERHUMAN: 'TRANSFER_HUMAN',
  CONFIRM: 'CONFIRMATION', CONFIRMED: 'CONFIRMATION', CONFIRMACAO: 'CONFIRMATION',
  REJECT: 'REJECTION', REJECTED: 'REJECTION', RECUSA: 'REJECTION',
  PERGUNTA: 'QUESTION', QUESTAO: 'QUESTION', ANSWER: 'QUESTION', GREETING: 'QUESTION'
};

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALOR_RE = /r\$\s*\d|\d{1,3}(\.\d{3})+,\d{2}|\d+,\d{2}\s*(reais|r\$)/i;

const MAX_RESPOSTA   = 3000;
const MIN_CONFIANCA  = 0.6;

const MSG_ERRO       = 'Desculpe, tive um probleminha aqui. Pode repetir, por favor?';
const MSG_TRANSFER   = 'Vou te passar pra um atendente pra confirmar seus dados. Só um instante.';
const MSG_RECONFIRMA = 'Só pra eu não errar: me confirma qual plantão você quer antecipar?';
const MSG_SEM_DADOS  = 'Me confirma seu CPF (só os números) pra eu localizar seus plantões?';
const MSG_CPF_NAO_BATE = 'Não consegui localizar esse CPF no sistema. Pode conferir os números e me mandar de novo, por favor?';

const motivos = [];

function jsonDe(nome) {
  try {
    const item = $(nome).first();
    return (item && item.json) ? item.json : {};
  } catch (e) {
    return {};
  }
}

const ctx     = jsonDe('Edit Fields');
const trigger = jsonDe('When Executed by Another Workflow');

let bruto = ($json && $json.output !== undefined && $json.output !== null && $json.output !== '')
  ? $json.output
  : '';
if (bruto === '') {
  const ag = jsonDe('AI Agent — Ana Medflow1');
  bruto = (ag.output === undefined || ag.output === null) ? '' : ag.output;
}

const MAX_INICIOS = 200;
const MAX_BLOCO   = 20000;

function blocoBalanceado(texto, inicio) {
  let prof = 0, emString = false, escape = false;
  const fim = Math.min(texto.length, inicio + MAX_BLOCO);

  for (let i = inicio; i < fim; i++) {
    const c = texto[i];
    if (emString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') emString = false;
      continue;
    }
    if (c === '"') { emString = true; continue; }
    if (c === '{') { prof++; continue; }
    if (c === '}') {
      prof--;
      if (prof === 0) return texto.slice(inicio, i + 1);
      if (prof < 0) return null;
    }
  }
  return null;
}

function blocosJson(texto) {
  const blocos = [];
  let i = texto.indexOf('{');
  let tentativas = 0;
  while (i !== -1 && tentativas < MAX_INICIOS) {
    const bloco = blocoBalanceado(texto, i);
    if (bloco) blocos.push(bloco);
    tentativas++;
    i = texto.indexOf('{', i + 1);
  }
  return blocos;
}

function ehRespostaDaIa(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj) &&
    (Object.prototype.hasOwnProperty.call(obj, 'response') ||
     Object.prototype.hasOwnProperty.call(obj, 'intent'));
}

function extrairObjeto(valor) {
  if (ehRespostaDaIa(valor)) return valor;
  if (valor && typeof valor === 'object') return null;

  const texto = String(valor === null || valor === undefined ? '' : valor)
    .replace(/```[a-zA-Z]*/g, '')
    .replace(/```/g, '')
    .trim();
  if (!texto) return null;

  try {
    const direto = JSON.parse(texto);
    if (ehRespostaDaIa(direto)) return direto;
  } catch (e) { /* cai no scan abaixo */ }

  const blocos = blocosJson(texto);
  for (let i = 0; i < blocos.length; i++) {
    try {
      const obj = JSON.parse(blocos[i]);
      if (ehRespostaDaIa(obj)) return obj;
    } catch (e) { /* proximo bloco */ }
  }
  return null;
}

function semControle(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    if (k > 31 || k === 9 || k === 10) out += s[i];
  }
  return out;
}

function limpar(t) {
  if (t === null || t === undefined) return '';
  if (typeof t === 'object') {
    t = Array.isArray(t) ? t.filter(function (x) { return typeof x === 'string'; }).join('\n')
                         : (typeof t.text === 'string' ? t.text
                            : (typeof t.message === 'string' ? t.message : ''));
    if (!t) motivos.push('response_nao_textual');
  }
  let s = semControle(String(t))
    .replace(/```[a-zA-Z]*/g, '')
    .replace(/```/g, '')
    .replace(/\[INTENT:\s*[A-Za-z_]+\]/gi, '')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length > MAX_RESPOSTA) {
    s = s.slice(0, MAX_RESPOSTA - 1).trim() + '…';
    motivos.push('resposta_truncada');
  }
  return s;
}

const parsed = extrairObjeto(bruto);

let resposta  = '';
let intent    = '';
let confianca = null;
let idBruto   = '';
let idsBruto  = '';
let filaBruta = '';

if (parsed) {
  resposta  = limpar(parsed.response);
  intent    = String(parsed.intent === null || parsed.intent === undefined ? '' : parsed.intent)
                .toUpperCase().replace(/[^A-Z_]/g, '');
  confianca = typeof parsed.confidence === 'number' ? parsed.confidence
              : (parsed.confidence !== '' && !isNaN(parseFloat(parsed.confidence)) ? parseFloat(parsed.confidence) : null);
  idBruto   = parsed.plantao_id       == null ? '' : String(parsed.plantao_id);
  idsBruto  = parsed.plantao_ids      == null ? '' : String(parsed.plantao_ids);
  filaBruta = parsed.fila_plantao_ids == null ? '' : String(parsed.fila_plantao_ids);
} else {
  resposta = limpar(bruto);
  intent   = 'QUESTION';
  motivos.push('saida_nao_estruturada');
}

if (ALIAS_INTENT[intent]) intent = ALIAS_INTENT[intent];
if (INTENTS_VALIDOS.indexOf(intent) === -1) {
  if (intent) motivos.push('intent_invalido:' + intent);
  intent = 'QUESTION';
}

function somenteUuids(str) {
  return String(str || '')
    .split(/[,\s;]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return UUID_RE.test(s); })
    .map(function (s) { return s.toLowerCase(); });
}

let ids = somenteUuids(idsBruto);
if (ids.length === 0) ids = somenteUuids(idBruto);
ids = Array.from(new Set(ids));

const fila = Array.from(new Set(somenteUuids(filaBruta)))
  .filter(function (id) { return ids.indexOf(id) === -1; });

if ((idsBruto || idBruto) && ids.length === 0) motivos.push('plantao_id_nao_e_uuid');

function consultaMedFlow() {
  const passos = ($json && Array.isArray($json.intermediateSteps)) ? $json.intermediateSteps : [];
  let chamou = false;
  let ultimo = null;

  for (let i = 0; i < passos.length; i++) {
    const p = passos[i] || {};
    const acao = p.action || {};
    const nome = String(acao.tool || acao.name || '');
    if (nome.indexOf('consultar_medflow') === -1) continue;

    chamou = true;
    const obs = p.observation;
    let dado = obs;
    if (typeof obs === 'string') {
      try { dado = JSON.parse(obs); } catch (e) { dado = null; }
    }
    // A tool pode devolver array (o n8n embrulha a saida do sub-workflow) e,
    // quando o sub-workflow esta fora do ar, um {error} sem auth_ok nenhum.
    if (Array.isArray(dado)) dado = dado.length ? dado[0] : null;
    if (dado && typeof dado === 'object') ultimo = dado;
  }

  return {
    chamou: chamou,
    ok: !!(ultimo && ultimo.auth_ok === true),
    erro: ultimo ? String(ultimo.auth_error || '') : '',
    infra: !!(ultimo && ultimo.auth_ok === undefined && ultimo.error)
  };
}

const medflow   = consultaMedFlow();
const degradado = !medflow.ok;

if (degradado) {
  if (!medflow.chamou) motivos.push('medflow_nao_consultada');
  else motivos.push('medflow_auth_falhou' + (medflow.erro ? ':' + medflow.erro : ''));
}
if (!String(ctx.doctor_cpf || '').trim()) motivos.push('cpf_ausente_no_cadastro');

// 5a0. TRANSFER_HUMAN que a IA inventou porque a MedFlow caiu NAO passa.
const PEDIU_HUMANO = /(atendente|humano|pessoa de verdade|falar com algu[eé]m|falar com uma pessoa|suporte|gerente|consultor)/i;
const pediuHumano  = PEDIU_HUMANO.test(String(ctx.user_message || trigger.mensagem || ''));
const ERRO_DE_CPF  = /(cpf_ausente|cpf_invalido|verification_failed|user_not_found|identity_conflict)/i;

if (intent === 'TRANSFER_HUMAN' && degradado && !pediuHumano) {
  intent   = 'QUESTION';
  resposta = ERRO_DE_CPF.test(medflow.erro) ? MSG_CPF_NAO_BATE : MSG_SEM_DADOS;
  motivos.push('transfer_por_falha_medflow_rebaixado' +
    (medflow.erro ? ':' + medflow.erro : (medflow.infra ? ':infra' : '')));
}

if (intent === 'CONFIRMATION' && degradado && !medflow.chamou) {
  intent   = 'QUESTION';
  resposta = MSG_RECONFIRMA;
  motivos.push('confirmation_sem_consulta');
}
if (intent === 'CONFIRMATION' && degradado) {
  intent   = 'TRANSFER_HUMAN';
  resposta = MSG_TRANSFER;
  motivos.push('confirmation_sem_medflow' + (medflow.erro ? ':' + medflow.erro : ''));
}

if (intent === 'CONFIRMATION' && !String(ctx.doctor_id || '').trim()) {
  intent   = 'TRANSFER_HUMAN';
  resposta = MSG_TRANSFER;
  motivos.push('confirmation_sem_doctor_id');
}

if (intent === 'CONFIRMATION' && confianca !== null && confianca < MIN_CONFIANCA) {
  intent   = 'QUESTION';
  resposta = MSG_RECONFIRMA;
  motivos.push('confirmation_confianca_baixa:' + confianca);
}

if (intent === 'CONFIRMATION' && ids.length === 0) {
  intent   = 'QUESTION';
  resposta = MSG_RECONFIRMA;
  motivos.push('confirmation_sem_uuid');
}

if (degradado && intent !== 'TRANSFER_HUMAN' && VALOR_RE.test(resposta)) {
  intent   = 'QUESTION';
  resposta = MSG_SEM_DADOS;
  motivos.push('valor_sem_medflow');
}

const CPF_NO_TEXTO = /(?<!\d)(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{2})(?!\d)/g;
if (CPF_NO_TEXTO.test(resposta)) {
  CPF_NO_TEXTO.lastIndex = 0;
  resposta = resposta.replace(CPF_NO_TEXTO, function (m, a, b, c, d) { return a + '***' + d; });
  motivos.push('cpf_ecoado_mascarado');
}

if (!resposta) {
  if (intent === 'CONFIRMATION') { intent = 'QUESTION'; motivos.push('confirmation_sem_texto'); }
  resposta = intent === 'TRANSFER_HUMAN' ? MSG_TRANSFER : MSG_ERRO;
  motivos.push('resposta_vazia');
}

const idsFinais = intent === 'CONFIRMATION' ? ids  : [];
const filaFinal = intent === 'CONFIRMATION' ? fila : [];

return [{
  json: {
    phone:             ctx.phone || trigger.phone || '',
    user_message:      ctx.user_message || trigger.mensagem || '',
    doctor_id:         ctx.doctor_id || '',
    doctor_name:       ctx.doctor_name || '',
    doctor_cpf:        ctx.doctor_cpf || '',
    doctor_email:      ctx.doctor_email || '',
    hospital:          ctx.hospital || '',
    receivable_value:  ctx.receivable_value === undefined ? null : ctx.receivable_value,
    instancia:         trigger.instancia || '',
    medflow_auth_ok:    medflow.ok,
    medflow_consultada: medflow.chamou,
    medflow_degradado:  degradado,
    medflow_auth_error: medflow.erro || (medflow.infra ? 'tool_indisponivel' : ''),
    ai_response:       resposta,
    intent:            intent,
    confidence:        confianca,
    plantao_id:        idsFinais[0] || '',
    plantao_ids:       idsFinais.join(','),
    fila_plantao_ids:  filaFinal.join(','),
    guard_reasons:     motivos.join('|')
  }
}];
};
