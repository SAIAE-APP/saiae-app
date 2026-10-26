#!/usr/bin/env node
// SPIKE DESCARTAVEL (Task 1 do plano de pagamento marketplace). Nao vai para producao.
// Use SOMENTE com contas e credenciais de TESTE do Mercado Pago. Nunca imprime segredos.
// Docs usadas:
//  OAuth/URL de autorizacao e /oauth/token:
//    https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/additional-content/security/oauth/creation
//  Pagamento com application_fee (marketplace):
//    https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/how-tos/integrate-marketplace
//  Cartoes de teste e nomes de titular (APRO/OTHE):
//    https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/cards
//  Reembolso:
//    https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/payment-management/cancellations-and-refunds/refund-pix
// NAO confirmado nas docs consultadas: formato exato de POST /v1/card_tokens (usado o corpo padrao do
// tokenizador do SDK JS) e o caminho exato da comissao na resposta (por isso o script varre a resposta).
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API = 'https://api.mercadopago.com';
const ENV_FILE = fileURLToPath(new URL('../.env.spike', import.meta.url));
const FEE = 0.99;
const VALOR = 10.0;

// Carrega .env.spike (KEY=VALUE) sem sobrescrever o que ja esta no ambiente.
if (existsSync(ENV_FILE)) {
  for (const linha of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const exige = (...nomes) => {
  const falta = nomes.filter((n) => !process.env[n]);
  if (falta.length) { console.error(`Faltam variaveis (.env.spike): ${falta.join(', ')}`); process.exit(1); }
};
const sandbox = () => {
  if (process.env.MP_SPIKE_SANDBOX !== 'sim') {
    console.error('Defina MP_SPIKE_SANDBOX=sim para confirmar que so usa credenciais de TESTE.');
    process.exit(1);
  }
};

async function chamar(metodo, caminho, { token, corpo, idem } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idem) headers['X-Idempotency-Key'] = randomUUID();
  const r = await fetch(API + caminho, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
  const json = await r.json().catch(() => ({}));
  return { http: r.status, json };
}

// Varre a resposta e devolve caminhos onde a comissao aparece (so numeros/tipos, nunca QR ou tokens).
function achaComissao(obj, caminho = '', saida = []) {
  if (Array.isArray(obj)) obj.forEach((v, i) => achaComissao(v, `${caminho}[${i}]`, saida));
  else if (obj && typeof obj === 'object') {
    const tipoFee = Object.values(obj).some((v) => typeof v === 'string' && /fee/i.test(v));
    for (const [k, v] of Object.entries(obj)) {
      const p = caminho ? `${caminho}.${k}` : k;
      if (/fee/i.test(k) && (typeof v !== 'object' || v === null)) saida.push(`${p} = ${v}`);
      else if (tipoFee && k === 'amount') saida.push(`${p} = ${v} (irmao com tipo contendo "fee")`);
      else achaComissao(v, p, saida);
    }
  }
  return saida;
}

function resultado(linhas) {
  console.log('\n=== RESULTADO (copiar para o spec, secao "Resultado do spike") ===');
  linhas.forEach((l) => console.log(`- ${l}`));
}

async function fatosPagamento(rotulo, token, criado) {
  const { http, json } = criado;
  if (!json.id) {
    console.log(`${rotulo}: HTTP ${http} sem id. message=${json.message ?? '-'} error=${json.error ?? '-'} cause=${JSON.stringify(json.cause ?? [])}`);
    resultado([`(a) application_fee aceito? NAO (criacao falhou: HTTP ${http}, ${json.message ?? json.error ?? 'sem mensagem'})`]);
    return;
  }
  const lido = await chamar('GET', `/v1/payments/${json.id}`, { token });
  const caminhos = achaComissao(lido.json);
  const caminhosCriacao = achaComissao(json);
  console.log(`${rotulo}: id=${json.id} status=${lido.json.status} status_detail=${lido.json.status_detail}`);
  console.log(`transaction_amount=${lido.json.transaction_amount} application_fee(campo raiz)=${lido.json.application_fee ?? 'ausente'}`);
  console.log('Caminhos com comissao no GET:', caminhos.length ? caminhos : 'nenhum');
  console.log('Caminhos com comissao no POST:', caminhosCriacao.length ? caminhosCriacao : 'nenhum');
  const aceito = caminhos.some((c) => /0\.99/.test(c)) || lido.json.application_fee === FEE;
  resultado([
    `(a) application_fee aceito? ${aceito ? 'SIM' : 'NAO/INCERTO (ver caminhos acima)'} - ${rotulo}, status ${lido.json.status}`,
    `(b) caminho(s) do campo da comissao: ${caminhos.join(' | ') || 'nenhum encontrado'}`,
    '(c) escopo OAuth: rode "trocar" (imprime o scope)',
    '(d) formato da URL de autorizacao: rode "auth-url"',
    '(e) estorno: rode "estorno <payment_id>"',
  ]);
  console.log(`payment_id para o estorno: ${json.id}`);
}

const comandos = {
  async 'auth-url'() {
    exige('MP_CLIENT_ID', 'MP_REDIRECT_URI');
    const state = randomBytes(12).toString('hex');
    const q = new URLSearchParams({ client_id: process.env.MP_CLIENT_ID, response_type: 'code', platform_id: 'mp', state, redirect_uri: process.env.MP_REDIRECT_URI });
    const url = `https://auth.mercadopago.com/authorization?${q}`;
    console.log('Abra logado na conta VENDEDORA DE TESTE:\n' + url);
    resultado([`(d) formato da URL: https://auth.mercadopago.com/authorization?client_id=...&response_type=code&platform_id=mp&state=...&redirect_uri=... (state desta rodada: ${state})`]);
  },

  async trocar(code) {
    if (!code) throw new Error('Uso: trocar <code>');
    sandbox(); exige('MP_CLIENT_ID', 'MP_CLIENT_SECRET', 'MP_REDIRECT_URI');
    const { http, json } = await chamar('POST', '/oauth/token', { corpo: {
      client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET, code,
      grant_type: 'authorization_code', redirect_uri: process.env.MP_REDIRECT_URI, test_token: 'true',
    } });
    if (!json.access_token) {
      console.log(`Falhou: HTTP ${http} message=${json.message ?? json.error ?? '-'}`);
      return resultado([`(c) OAuth falhou: HTTP ${http} ${json.message ?? json.error ?? ''}`]);
    }
    appendFileSync(ENV_FILE, `\nMP_SELLER_ACCESS_TOKEN=${json.access_token}\nMP_SELLER_REFRESH_TOKEN=${json.refresh_token ?? ''}\n`, { mode: 0o600 });
    // Windows ignora o modo POSIX: restringe a ACL ao usuario atual (melhor esforco).
    if (process.platform === 'win32') {
      try { execFileSync('icacls', [ENV_FILE, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], { stdio: 'ignore' }); }
      catch { console.log('Aviso: nao consegui restringir a ACL do .env.spike.'); }
    }
    console.log(`user_id=${json.user_id} scope=${json.scope} expires_in=${json.expires_in} live_mode=${json.live_mode} (tokens gravados em .env.spike)`);
    resultado([`(c) escopo/permissoes vistos: scope="${json.scope}", expires_in=${json.expires_in}, live_mode=${json.live_mode}`, `(d) redirect_uri usada: ${process.env.MP_REDIRECT_URI}`]);
  },

  async pix() {
    sandbox(); exige('MP_SELLER_ACCESS_TOKEN');
    const token = process.env.MP_SELLER_ACCESS_TOKEN;
    const criado = await chamar('POST', '/v1/payments', { token, idem: true, corpo: {
      transaction_amount: VALOR, payment_method_id: 'pix', application_fee: FEE,
      description: 'Spike Sai ae - Pix', payer: { email: process.env.MP_PAYER_EMAIL || 'comprador.teste@example.com' },
    } });
    await fatosPagamento('Pix', token, criado);
  },

  async cartao(nome = 'APRO') {
    sandbox(); exige('MP_SELLER_ACCESS_TOKEN', 'MP_PUBLIC_KEY');
    const token = process.env.MP_SELLER_ACCESS_TOKEN;
    // Mastercard de teste documentado; o nome do titular define o resultado (APRO aprova, OTHE recusa).
    const tk = await chamar('POST', `/v1/card_tokens?public_key=${encodeURIComponent(process.env.MP_PUBLIC_KEY)}`, { corpo: {
      card_number: '5480832801033311', security_code: '123', expiration_month: 11, expiration_year: 2030,
      cardholder: { name: nome, identification: { type: 'CPF', number: '12345678909' } },
    } });
    if (!tk.json.id) {
      console.log(`Tokenizacao falhou: HTTP ${tk.http} message=${tk.json.message ?? tk.json.error ?? '-'}`);
      return resultado([`Tokenizacao do cartao falhou (HTTP ${tk.http}); formato de card_tokens nao confirmado nas docs.`]);
    }
    const criado = await chamar('POST', '/v1/payments', { token, idem: true, corpo: {
      transaction_amount: VALOR, token: tk.json.id, installments: 1, payment_method_id: 'master', application_fee: FEE,
      description: `Spike Sai ae - cartao ${nome}`, payer: { email: process.env.MP_PAYER_EMAIL || 'comprador.teste@example.com' },
    } });
    await fatosPagamento(`Cartao (${nome})`, token, criado);
  },

  async 'cartao-recusado'() { return comandos.cartao('OTHE'); },

  async estorno(id) {
    if (!id) throw new Error('Uso: estorno <payment_id>');
    sandbox(); exige('MP_SELLER_ACCESS_TOKEN');
    const token = process.env.MP_SELLER_ACCESS_TOKEN;
    const r = await chamar('POST', `/v1/payments/${id}/refunds`, { token, idem: true, corpo: {} }); // corpo vazio = estorno total
    console.log(`HTTP ${r.http} status=${r.json.status ?? '-'} chaves=${Object.keys(r.json).join(',')}`);
    const lido = await chamar('GET', `/v1/payments/${id}`, { token });
    console.log(`Pagamento apos estorno: status=${lido.json.status} status_detail=${lido.json.status_detail} transaction_amount_refunded=${lido.json.transaction_amount_refunded}`);
    console.log('Comissao no pagamento apos estorno:', achaComissao(lido.json));
    resultado([`(e) estorno: HTTP ${r.http}, status do estorno "${r.json.status ?? '-'}", pagamento "${lido.json.status}/${lido.json.status_detail}", valor estornado ${lido.json.transaction_amount_refunded}; confira no painel do marketplace se os R$ 0,99 voltaram (a API nao diz isso diretamente).`]);
  },
};

const [cmd, arg] = process.argv.slice(2);
if (!comandos[cmd]) { console.error('Uso: node scripts/spike-mp-marketplace.mjs <auth-url|trocar <code>|pix|cartao|cartao-recusado|estorno <payment_id>>'); process.exit(1); }
comandos[cmd](arg).catch((e) => { console.error(`Erro: ${e.message}`); process.exit(1); });
