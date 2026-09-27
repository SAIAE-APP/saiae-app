# Auditoria de segurança — Sai aê (ex-MesaAgil)

Data: 2026-09-27 · Branch: `security-audit` · Projeto Supabase: `dzlxjftfbtdgyllgztfp` (us-west-2)

## Resumo executivo

Auditoria completa (mapeamento, segredos, RLS/Supabase, autenticação/autorização, APIs,
infraestrutura, dependências) do app Sai aê (React/Vite + Supabase + Cloudflare Pages).
Achado principal: uma falha de RLS permitia que qualquer usuário autenticado injetasse
pedidos falsos na cozinha de **outras** barracas (bypass de multi-tenant), e a Edge
Function de emissão fiscal (`emitir-nfce`) não verificava autorização, permitindo forçar
emissão de notas fiscais reais de qualquer barraca. **Ambos corrigidos e já aplicados em
produção** (migration via `supabase db push`, função via `supabase functions deploy`,
verificado após o deploy). Não foram encontrados segredos expostos, XSS ou SQL injection.
Dependências de produção sem CVEs conhecidas.

## Achados

| Severidade | Local | Descrição | Status |
|---|---|---|---|
| **CRÍTICO** | `pedidos`/`itens_do_pedido`, policies RLS de INSERT | Duas policies PERMISSIVE por tabela se combinavam com OR — bastava a barraca alvo ter assinatura ativa (comum) pra qualquer usuário autenticado inserir pedidos/itens em barraca de outro dono. `barraca_id` alvo é descobrível via `cardapio_publico(slug)` (pública por design) | **Corrigido e aplicado em produção** — migration `20260927150000_fix_rls_or_bypass_pedidos.sql` (commit `8d45d4e`), verificado via `pg_policies` após o push |
| **CRÍTICO** | `supabase/functions/emitir-nfce/index.ts` | Edge Function com service role, sem checagem de que o chamador pertence à barraca do pedido. `verify_jwt=true` só exige *algum* JWT (a anon key pública já basta) — qualquer pessoa com um `pedido_id` forçava emissão de NFC-e real | **Corrigido e deployado em produção** (commit `54051d2`, versão 3 ativa) |
| MÉDIO | Funções `usuario_tem_acesso_barraca`, `assinatura_tem_acesso`, `minha_assinatura`, `criar_pedido`, `set_senha_pedido` | `search_path` mutável (achado do linter de segurança do Supabase) — a primeira é `SECURITY DEFINER` e é a checagem de acesso usada em quase toda policy do projeto | **Corrigido e aplicado em produção** — migration `20260927150100_fix_function_search_path.sql` (commit `7778f01`) |
| MÉDIO | Deploy Cloudflare Pages | Nenhum header de segurança (CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy) | **Corrigido** — `public/_headers` (commit `fbad011`) |
| MÉDIO | Supabase Auth → Settings → Auth | Proteção contra senha vazada (HaveIBeenPwned) desabilitada | **Pendente — ação manual** |
| BAIXO | `criar-pagamento-pix`, `webhook-mercadopago`, `emitir-nfce` | Sem rate limiting próprio em endpoints públicos que chamam APIs de terceiros (custo/DoS) | **Pendente — recomendação** |
| BAIXO | Dependências dev (`wrangler`/`miniflare`/`@capacitor/cli`/`@capacitor/assets`) | `npm audit`: 6 HIGH + 1 CRITICAL, todas em devDependencies (toolchain de build, não vão pro bundle do usuário). Sem fix automático disponível sem bump major | **Documentado — sem ação segura disponível agora** |
| Informativo | `processar_webhook_kirvano`, `consultar_status_pagamento` | Autorização via segredo estático (192 bits) / UUID não enumerável, sem policy de leitura — revisado, risco aceito pelo desenho atual | Revisado, nenhuma ação necessária |
| Informativo | `webhook-mercadopago` | Não valida assinatura do payload, mas nunca confia nele — sempre reconfirma o status via GET na API do Mercado Pago antes de agir | Revisado, nenhuma ação necessária |

### Evidência do achado crítico de RLS

```
pg_policies (antes da correção):
  pedidos / INSERT / "usuarios inserem pedidos em suas barracas"
    with_check: usuario_tem_acesso_barraca(barraca_id)
  pedidos / INSERT / "assinatura da barraca precisa estar ativa pra novos pedidos"
    with_check: barraca_assinatura_ativa(barraca_id)
```

Duas policies PERMISSIVE pro mesmo comando = OR no Postgres. `cardapio_publico(p_slug)`
(SECURITY DEFINER, pública) devolve `barraca_id` no 1º campo — confirma que o alvo é
descobrível por qualquer usuário via o link público do cardápio de qualquer barraca.

### Evidência do achado crítico de `emitir-nfce`

`supabase functions list --project-ref dzlxjftfbtdgyllgztfp` confirma `verify_jwt: true`
tanto em `emitir-nfce` quanto `criar-pagamento-pix` — mas a função nunca inspecionava
*quem* era o portador do JWT, só que existia um. Como a anon key é pública
(`.env.local`/bundle do cliente), isso equivale a nenhuma autenticação real.

## Ações manuais necessárias

1. **Habilitar "Leaked Password Protection"** no painel Supabase (Authentication →
   Policies/Settings) — checagem contra HaveIBeenPwned, hoje desabilitada. Não aplicado
   nesta rodada por ser uma configuração de painel, fora do fluxo de migrations/código.
2. **Configurar rate limiting** (regra no painel Cloudflare, ou equivalente) nas rotas
   `criar-pagamento-pix`, `webhook-mercadopago` e `emitir-nfce` — hoje sem limite próprio.

As duas correções críticas (migrations de RLS/search_path e deploy do `emitir-nfce`)
já foram aplicadas em produção nesta sessão, com aprovação explícita do usuário.

## Fora do escopo desta rodada

- Upgrade das devDependencies vulneráveis (`wrangler`/`@capacitor/cli`) — exige bump
  major e teste completo do pipeline de build/Android, risco de quebrar fora do escopo
  de uma correção pontual de segurança.
- Validação de input com uma lib centralizada (ex. zod) nas Edge Functions/RPCs — hoje
  cada função valida manualmente (regex de PIN/slug, preço sempre resolvido server-side
  a partir do cardápio) e a cobertura atual pareceu adequada nos fluxos revisados, mas
  não há um padrão único.
- CSP testada apenas por build estático — recomendo abrir o app em produção após o
  deploy e checar o console por violações de CSP antes de confiar 100% nela (fontes/
  Realtime/Storage do Supabase são os pontos mais prováveis de precisar de ajuste fino).

## Metodologia

Mapeamento da stack e rotas (Fase 1); grep de segredos no código, histórico do git e no
bundle de build (Fase 2, nada encontrado — hook de pre-commit já bloqueia isso); consulta
direta ao banco de produção via `supabase db query --linked` (RLS, policies, definições
de função) e `supabase db advisors --linked` (linter de segurança nativo do Supabase)
(Fase 3); leitura de todas as Edge Functions e funções SECURITY DEFINER expostas via RPC,
cruzando com `supabase functions list` pra confirmar `verify_jwt` (Fase 4); grep por
`dangerouslySetInnerHTML`/`eval`/`fetch` com URL controlada por usuário (Fase 5); revisão
de `vite.config.ts`/`wrangler.toml`/`index.html` pra headers, CSP e sourcemaps (Fase 6);
`npm audit` (Fase 7).
