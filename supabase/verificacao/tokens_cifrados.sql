-- Verificação dos tokens cifrados (rodar no SQL editor do Supabase, SÓ LEITURA). Mostra contagens, nunca valores.

-- 1) Tokens que ainda estão SÓ em texto (sem cifrado). Esperado depois do backfill: tudo 0.
select 'fiscal.token_homologacao' as campo, count(*) as sem_cifra from public.barracas_fiscal_token where token_homologacao is not null and token_homologacao <> '' and token_homologacao_cifrado is null
union all select 'fiscal.token_producao', count(*) from public.barracas_fiscal_token where token_producao is not null and token_producao <> '' and token_producao_cifrado is null
union all select 'pagamento.access_token', count(*) from public.barracas_pagamento_token where access_token is not null and access_token <> '' and access_token_cifrado is null
union all select 'pagamento.segredo_webhook', count(*) from public.barracas_pagamento_token where segredo_webhook is not null and segredo_webhook <> '' and segredo_webhook_cifrado is null;

-- 2) Quanto já está cifrado e quanto ainda guarda o texto (o texto só some na fase 3; até lá é esperado ser > 0).
select 'fiscal.token_homologacao' as campo, count(token_homologacao_cifrado) as cifrados, count(token_homologacao) as ainda_com_texto from public.barracas_fiscal_token
union all select 'fiscal.token_producao', count(token_producao_cifrado), count(token_producao) from public.barracas_fiscal_token
union all select 'pagamento.access_token', count(access_token_cifrado), count(access_token) from public.barracas_pagamento_token
union all select 'pagamento.segredo_webhook', count(segredo_webhook_cifrado), count(segredo_webhook) from public.barracas_pagamento_token;

-- 3) Versões de chave em uso (rotação): depois de recifrar, só a versão atual.
select cifrado_chave, count(*) from public.barracas_fiscal_token where cifrado_chave is not null group by 1
union all select cifrado_chave, count(*) from public.barracas_pagamento_token where cifrado_chave is not null group by 1;

-- 4) PROVA DE QUE NÃO SOBROU TEXTO (só vale DEPOIS da fase 3, quando o texto for apagado). Esperado: 0.
select
  (select count(*) from public.barracas_fiscal_token where token_homologacao is not null or token_producao is not null)
  + (select count(*) from public.barracas_pagamento_token where access_token is not null or segredo_webhook is not null) as linhas_com_texto;
