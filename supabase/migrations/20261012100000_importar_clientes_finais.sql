-- Importação de clientes (planilha) para `clientes_finais`, em lotes, via RPC.
--
-- Regras (decisões do dono do produto, LGPD conservadora):
--  * só usuário autenticado COM acesso à barraca (usuario_tem_acesso_barraca);
--    anon e public sem execute;
--  * telefone normalizado como no resto do sistema (só dígitos, sem o 55 do país
--    quando sobram 12/13 dígitos); aceita 10–15 dígitos (a CHECK da tabela é 8–15,
--    a importação é mais rígida); nome vazio ou telefone inválido = linha ignorada;
--  * DEDUPE por (barraca_id, telefone): quem já existe NUNCA é sobrescrito; só
--    campos VAZIOS (nome/rua/numero/bairro/referencia/origem) são completados, e
--    só gera UPDATE se algo realmente mudar (então repetir o mesmo lote devolve
--    0 inseridos e 0 atualizados: idempotente);
--  * telefone repetido dentro do mesmo lote vale a primeira ocorrência;
--  * contatos novos entram com origem = 'importacao' e SEM consentimento de
--    marketing (consentimento_marketing_em NULL), a menos que o dono marque que
--    os clientes autorizaram (p_marketing = true): aí grava now() só nas linhas
--    NOVAS. Cadastro já existente nunca tem o consentimento alterado pela
--    importação. consentimento_lgpd_em fica NULL: é o consentimento do próprio
--    cliente, que a importação não pode inventar;
--  * lote de até 500 clientes por chamada.
--
-- ADITIVA: só cria uma função nova. Nenhuma tabela/coluna/função existente muda.

create or replace function public.importar_clientes_finais(
  p_barraca_id uuid,
  p_clientes jsonb,
  p_marketing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recebidos integer;
  v_validos integer;
  v_inseridos integer;
  v_atualizados integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  if p_barraca_id is null or not public.usuario_tem_acesso_barraca(p_barraca_id) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;
  if p_clientes is null or jsonb_typeof(p_clientes) <> 'array' then
    return jsonb_build_object('estado', 'dados_invalidos');
  end if;

  v_recebidos := jsonb_array_length(p_clientes);
  if v_recebidos > 500 then
    return jsonb_build_object('estado', 'lote_grande');
  end if;

  with bruto as (
    select t.ord,
           t.e,
           regexp_replace(coalesce(t.e->>'telefone', ''), '\D', '', 'g') as d
      from jsonb_array_elements(p_clientes) with ordinality as t(e, ord)
     where jsonb_typeof(t.e) = 'object'
  ),
  norm as (
    select ord, e,
           case when length(d) in (12, 13) and left(d, 2) = '55' then substr(d, 3) else d end as tel
      from bruto
  ),
  validos as (
    select distinct on (tel)
           tel,
           left(btrim(e->>'nome'), 120) as nome,
           left(btrim(coalesce(e->>'rua', '')), 160) as rua,
           left(btrim(coalesce(e->>'numero', '')), 20) as numero,
           left(btrim(coalesce(e->>'bairro', '')), 80) as bairro,
           nullif(left(btrim(coalesce(e->>'referencia', '')), 160), '') as referencia
      from norm
     where length(tel) between 10 and 15
       and btrim(coalesce(e->>'nome', '')) <> ''
     order by tel, ord
  ),
  gravados as (
    insert into public.clientes_finais as c
      (barraca_id, nome, telefone, rua, numero, bairro, referencia, origem, consentimento_marketing_em)
    select p_barraca_id, v.nome, v.tel, v.rua, v.numero, v.bairro, v.referencia, 'importacao',
           case when p_marketing then now() else null end
      from validos v
    on conflict (barraca_id, telefone) do update
       set nome = case when btrim(c.nome) = '' then excluded.nome else c.nome end,
           rua = case when btrim(c.rua) = '' then excluded.rua else c.rua end,
           numero = case when btrim(c.numero) = '' then excluded.numero else c.numero end,
           bairro = case when btrim(c.bairro) = '' then excluded.bairro else c.bairro end,
           referencia = case when nullif(btrim(coalesce(c.referencia, '')), '') is null
                             then excluded.referencia else c.referencia end,
           origem = coalesce(c.origem, excluded.origem)
     where (btrim(c.nome) = '' and btrim(excluded.nome) <> '')
        or (btrim(c.rua) = '' and btrim(excluded.rua) <> '')
        or (btrim(c.numero) = '' and btrim(excluded.numero) <> '')
        or (btrim(c.bairro) = '' and btrim(excluded.bairro) <> '')
        or (nullif(btrim(coalesce(c.referencia, '')), '') is null and excluded.referencia is not null)
        or (c.origem is null)
    returning (xmax = 0) as inserido
  )
  select (select count(*) from validos),
         count(*) filter (where inserido),
         count(*) filter (where not inserido)
    into v_validos, v_inseridos, v_atualizados
    from gravados;

  return jsonb_build_object(
    'estado', 'ok',
    'recebidos', v_recebidos,
    'inseridos', v_inseridos,
    'atualizados', v_atualizados,
    'ignorados', v_recebidos - v_validos,
    'sem_mudanca', v_validos - v_inseridos - v_atualizados
  );
end;
$$;

-- Supabase concede execute a anon por padrão em funções novas do schema public:
-- revoga explicitamente. Só usuário autenticado.
revoke all on function public.importar_clientes_finais(uuid, jsonb, boolean) from public, anon;
grant execute on function public.importar_clientes_finais(uuid, jsonb, boolean) to authenticated;
