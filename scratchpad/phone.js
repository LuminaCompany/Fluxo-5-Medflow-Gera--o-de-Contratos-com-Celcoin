// === Normalizacao de telefone BR para o POST /service/token da MedFlow ===
//
// Descoberto em 2026-08-24 (exec 178870 / teste 178891): o WhatsApp entrega
// numeros de celular BR no formato legado de 12 digitos (55 + DDD + 8), sem o
// nono digito. O cadastro da MedFlow guarda 13 digitos (5561998430401).
// A API compara o numero inteiro e devolve 401 verification_failed quando nao bate.
// CPF sozinho tambem devolve 401 — o telefone e obrigatorio na pratica.
//
// phone_api = candidato preferido (13 digitos, com o 9)
// phone_alt = segundo candidato, tentado so se o primeiro der 401

function normalizarPhoneBR(raw) {
  let d = String(raw === null || raw === undefined ? '' : raw).replace(/\D/g, '');
  if (!d) return { phone_api: '', phone_alt: '' };

  d = d.replace(/^0+/, ''); // 0 de operadora / 0 de DDD

  // Sem DDI: 10 (fixo) ou 11 (celular) digitos -> prefixa 55
  if (d.length === 10 || d.length === 11) d = '55' + d;

  // Numero de fora do Brasil: nao mexe
  if (!d.startsWith('55') || d.length < 12) return { phone_api: d, phone_alt: '' };

  const ddd = d.slice(2, 4);
  const local = d.slice(4);

  // Celular legado (8 digitos comecando em 6-9): falta o nono digito
  if (local.length === 8 && /^[6-9]/.test(local)) {
    return { phone_api: '55' + ddd + '9' + local, phone_alt: d };
  }

  // Celular ja com 9 digitos: alt e a forma legada, caso o cadastro seja antigo
  if (local.length === 9 && local[0] === '9') {
    return { phone_api: d, phone_alt: '55' + ddd + local.slice(1) };
  }

  // Fixo (8 digitos comecando em 2-5) e qualquer outro caso: como veio
  return { phone_api: d, phone_alt: '' };
}

module.exports = { normalizarPhoneBR };
