const { normalizarPhoneBR } = require('./phone.js');

const casos = [
  // [entrada, phone_api esperado, phone_alt esperado]
  ['556198430401',   '5561998430401', '556198430401'],   // caso real do bug
  ['5561998430401',  '5561998430401', '556198430401'],   // ja normalizado
  ['+55 61 98430-401', '5561998430401', '556198430401'], // com mascara (12d)
  ['61998430401',    '5561998430401', '556198430401'],   // sem DDI, 11d
  ['6198430401',     '5561998430401', '556198430401'],   // sem DDI, 10d celular legado
  ['06198430401',    '5561998430401', '556198430401'],   // zero de operadora
  ['551133334444',   '551133334444',  ''],               // fixo SP, nao inventa 9
  ['5511333344445',  '5511333344445', ''],               // 13d que nao e celular padrao
  ['',               '',              ''],
  [null,             '',              ''],
  ['12025550123',    '5512025550123', ''],               // 11d sem DDI -> vira BR (limitacao aceita)
  ['351912345678',   '351912345678',  ''],               // internacional 12d nao-55
];

let falhas = 0;
for (const [entrada, apiEsp, altEsp] of casos) {
  const r = normalizarPhoneBR(entrada);
  const ok = r.phone_api === apiEsp && r.phone_alt === altEsp;
  if (!ok) {
    falhas++;
    console.log(`FALHOU  ${JSON.stringify(entrada)} -> api=${r.phone_api} alt=${r.phone_alt} (esperado api=${apiEsp} alt=${altEsp})`);
  } else {
    console.log(`ok      ${JSON.stringify(entrada)} -> api=${r.phone_api} alt=${r.phone_alt || '-'}`);
  }
}
console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os casos passaram');
process.exit(falhas ? 1 : 0);
