# Roteiro: tokens das lojas cifrados (fases 1 e 2)

Plano e justificativas: `docs/superpowers/plans/2026-10-12-criptografar-tokens-em-repouso.md`. Este roteiro é a ordem EXATA para o dono.
**Fase 3 (apagar o texto) NÃO está aqui**: só depois da janela de observação.

## Ordem

1. **Merge** do PR 1 (fase 1) e do PR 2 (fase 2). Nada vai ao ar sozinho.
2. **Migration** `20261027100000_tokens_cifrados_colunas.sql` (aditiva: colunas novas, `NOT NULL` afrouxado, "configurado" olhando texto OU cifrado). Aplicar ANTES de qualquer deploy.
3. **Gerar a chave** (32 bytes em base64) no seu computador e guardar uma cópia FORA do Supabase (gerenciador de senhas). Perder a chave = os tokens cifrados não voltam (a loja teria de colar o token de novo):
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
4. **Secret** nas Edge Functions: `supabase secrets set TOKENS_CHAVE_V1=<a chave>` (opcional `TOKENS_CHAVE_ATUAL=1`). Não cole a chave em chat, issue ou PR.
5. **Deploy das functions** (nesta ordem): `salvar-credencial` (nova), depois `emitir-nfce`, `criar-pagamento-pix`, `webhook-mercadopago`.
   - As três antigas só ganharam a leitura "cifrado, senão texto". Sem o secret ou com linhas só em texto, o comportamento é o de hoje.
6. **Deploy do front** (Cloudflare Pages) por último: Ajustes passa a salvar token/segredo pela `salvar-credencial`. Antes disso o front antigo continua gravando em texto pelas RPCs (que seguem existindo).
7. **Teste de fumaça** (loja de teste, ambiente de homologação): salvar o token da FocusNFe, salvar o token do Pix, emitir uma nota de homologação e gerar um Pix de valor baixo.
8. **Backfill** (no seu computador, com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `TOKENS_CHAVE_V1` no ambiente; nunca imprime valores):
   - Simulação, só conta: `node --experimental-strip-types scripts/backfill-tokens-cifrados.ts`
   - Cifrar de verdade: `node --experimental-strip-types scripts/backfill-tokens-cifrados.ts --aplicar`
   - Termina com código 0 e "OK" quando não sobrou token só em texto. Pode rodar de novo (idempotente) e em lotes de 100. **Não apaga o texto.**
9. **Verificação**: rodar `supabase/verificacao/tokens_cifrados.sql` no SQL editor (só leitura). O bloco 1 tem de dar 0 em todas as linhas. Os blocos 2 e 3 mostram quantos estão cifrados e com qual versão da chave. O bloco 4 (nenhum texto) só vale depois da fase 3.
10. **Janela de observação** (7 a 14 dias): procurar nos logs das functions por `segredo_cifrado_indisponivel` (o log traz só o código e o nome do campo). O esperado é zero. Se aparecer `sem_chave`, `falha_decifrar` ou `chave_invalida`, a leitura caiu no texto: corrigir antes de pensar na fase 3.

## Rollback

- **Antes do backfill / durante a observação**: o texto continua no banco. Para voltar atrás, reverter o front e as functions para o deploy anterior (ou remover o secret, e as leituras voltam a usar o texto). As RPCs `definir_token_*` e `definir_segredo_webhook_pagamento` continuam existindo e gravam em texto. A migration não precisa ser desfeita (colunas extras são ignoradas).
- **Atenção**: uma credencial salva DEPOIS do passo 6 existe só cifrada (a função zera o texto daquele campo). Voltar o front antigo não a recupera: o token antigo some da loja. Para esses casos, o dono (ou a loja) cola o token de novo, ou use o valor cifrado + chave para recuperar. Por isso a chave tem de existir em cópia segura até a fase 3 terminar.
- **Chave perdida ou comprometida**: se perdida, as lojas com token só cifrado precisam colar o token de novo. Se comprometida, gerar `TOKENS_CHAVE_V2`, `TOKENS_CHAVE_ATUAL=2`, recifrar e **revogar os tokens nos provedores** (FocusNFe, Mercado Pago), que é o que encerra o risco de verdade.

## Limites conhecidos

- Quem tiver a service role E os secrets das functions ainda lê os tokens (o servidor precisa usá-los).
- `usuario_tem_acesso_barraca` (RPC antiga) e a `salvar-credencial` aceitam qualquer membro da loja em `usuarios_barracas`; o acesso de suporte não cria linha ali e por isso não consegue gravar credencial (coberto em `tests/salvarCredencial.test.ts`).
- Nada disto foi testado contra Supabase, FocusNFe ou Mercado Pago reais.
