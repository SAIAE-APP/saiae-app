-- Assistente de configuração, passo 8: "Como você cobra a Mesa?" (comanda aberta + taxa de serviço).
-- Aditiva: só recria onboarding_salvar_passo com as MESMAS validações e grants; o passo 8 passa a aceitar
-- comanda_aberta_habilitada e taxa_servico_habilitada (colunas da migration 20261029100000).
-- Regras: sem as chaves (app antigo) nada muda; sem 'mesa' nos modos a comanda é forçada a false (nunca erro,
-- para o assistente não deixar estado incoerente); a taxa só vale com a comanda ligada.
-- Rollback: rodar de novo o bloco "create or replace function public.onboarding_salvar_passo" da migration
-- 20261020100000_onboarding_config.sql (a versão anterior ignora as chaves novas); as colunas ficam como estão.

create or replace function public.onboarding_salvar_passo(p_barraca_id uuid, p_etapa integer, p_dados jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d jsonb := coalesce(p_dados, '{}'::jsonb);
  v_lista text[];
  v_item jsonb;
  v_dia integer;
  v_aberto boolean;
  v_abre time;
  v_fecha time;
  v_algum_aberto boolean := false;
  v_concluido timestamptz;
  v_comanda boolean;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if not exists (
    select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p_barraca_id and papel = 'dono'
  ) then
    raise exception 'sem acesso a esta barraca';
  end if;
  if p_etapa is null or p_etapa not between 3 and 10 then
    raise exception 'etapa_invalida';
  end if;
  if jsonb_typeof(d) <> 'object' then
    raise exception 'dados_invalidos';
  end if;

  if p_etapa = 3 then
    -- A barraca acabou de nascer: leva a categoria escolhida no passo 2 (que ficou no usuário).
    update public.barracas b
       set categoria_negocio = coalesce(b.categoria_negocio, (select p.categoria_negocio from public.perfis_usuario p where p.usuario_id = auth.uid()))
     where b.id = p_barraca_id;

  elsif p_etapa = 4 then
    if d ? 'cnpj' and d->>'cnpj' is not null and d->>'cnpj' !~ '^[0-9]{14}$' then
      raise exception 'cnpj_invalido';
    end if;
    update public.barracas set
      cnpj = case when d ? 'cnpj' then nullif(d->>'cnpj', '') else cnpj end,
      sem_cnpj = case when d ? 'sem_cnpj' then coalesce((d->>'sem_cnpj')::boolean, false) else sem_cnpj end,
      emitente_razao_social = case when d ? 'razao_social' then nullif(left(btrim(d->>'razao_social'), 120), '') else emitente_razao_social end
    where id = p_barraca_id;

  elsif p_etapa = 5 then
    update public.barracas set
      endereco_cep = case when d ? 'cep' then nullif(regexp_replace(coalesce(d->>'cep', ''), '\D', '', 'g'), '') else endereco_cep end,
      endereco_rua = case when d ? 'rua' then nullif(left(btrim(d->>'rua'), 120), '') else endereco_rua end,
      endereco_numero = case when d ? 'numero' then nullif(left(btrim(d->>'numero'), 20), '') else endereco_numero end,
      endereco_complemento = case when d ? 'complemento' then nullif(left(btrim(d->>'complemento'), 80), '') else endereco_complemento end,
      endereco_bairro = case when d ? 'bairro' then nullif(left(btrim(d->>'bairro'), 80), '') else endereco_bairro end,
      endereco_cidade = case when d ? 'cidade' then nullif(left(btrim(d->>'cidade'), 80), '') else endereco_cidade end,
      endereco_uf = case when d ? 'uf' then nullif(upper(btrim(d->>'uf')), '') else endereco_uf end
    where id = p_barraca_id;

  elsif p_etapa = 6 then
    if coalesce(jsonb_typeof(d->'horarios'), '') <> 'array' or jsonb_array_length(d->'horarios') not between 1 and 7 then
      raise exception 'horarios_invalidos';
    end if;
    for v_item in select * from jsonb_array_elements(d->'horarios') loop
      v_dia := (v_item->>'dia')::integer;
      v_aberto := coalesce((v_item->>'aberto')::boolean, false);
      if v_dia is null or v_dia not between 0 and 6 then
        raise exception 'horarios_invalidos';
      end if;
      if v_aberto then
        v_abre := (v_item->>'abre')::time;
        v_fecha := (v_item->>'fecha')::time;
        if v_abre is null or v_fecha is null then
          raise exception 'horarios_invalidos';
        end if;
        v_algum_aberto := true;
      else
        v_abre := null;
        v_fecha := null;
      end if;
      insert into public.horarios_funcionamento (barraca_id, dia_semana, aberto, hora_abertura, hora_fechamento)
      values (p_barraca_id, v_dia, v_aberto, v_abre, v_fecha)
      on conflict (barraca_id, dia_semana) do update
        set aberto = excluded.aberto, hora_abertura = excluded.hora_abertura, hora_fechamento = excluded.hora_fechamento;
    end loop;
    -- Obrigatório: ao menos um dia aberto no conjunto final (não só neste envio).
    if not exists (select 1 from public.horarios_funcionamento where barraca_id = p_barraca_id and aberto) then
      raise exception 'horario_vazio';
    end if;

  elsif p_etapa = 7 then
    if coalesce(jsonb_typeof(d->'metodos'), '') <> 'array' then
      raise exception 'metodos_invalidos';
    end if;
    select coalesce(array_agg(distinct x), '{}') into v_lista from jsonb_array_elements_text(d->'metodos') x;
    if cardinality(v_lista) < 1 or not (v_lista <@ array['dinheiro', 'debito', 'credito', 'pix']::text[]) then
      raise exception 'metodos_invalidos';
    end if;
    update public.barracas set metodos_pagamento_ativos = to_jsonb(v_lista) where id = p_barraca_id;

  elsif p_etapa = 8 then
    if coalesce(jsonb_typeof(d->'modos'), '') <> 'array' then
      raise exception 'modos_invalidos';
    end if;
    select coalesce(array_agg(distinct x), '{}') into v_lista from jsonb_array_elements_text(d->'modos') x;
    if cardinality(v_lista) < 1 or not (v_lista <@ array['mesa', 'balcao', 'retirada', 'entrega']::text[]) then
      raise exception 'modos_invalidos';
    end if;
    update public.barracas set modos_atendimento = v_lista where id = p_barraca_id;
    -- Comanda aberta: só com a chave presente (sem resposta nada muda). Sem Mesa nunca liga; taxa só com comanda.
    if d ? 'comanda_aberta_habilitada' then
      v_comanda := coalesce((d->>'comanda_aberta_habilitada')::boolean, false) and 'mesa' = any(v_lista);
      update public.barracas set
        comanda_aberta_habilitada = v_comanda,
        taxa_servico_habilitada = case when d ? 'taxa_servico_habilitada'
          then coalesce((d->>'taxa_servico_habilitada')::boolean, false) and v_comanda
          else taxa_servico_habilitada end
      where id = p_barraca_id;
    end if;

  elsif p_etapa = 9 then
    update public.barracas set
      taxa_entrega_habilitada = case when d ? 'habilitada' then coalesce((d->>'habilitada')::boolean, false) else taxa_entrega_habilitada end,
      taxa_entrega_centavos = case when d ? 'centavos' then least(greatest(coalesce((d->>'centavos')::integer, 0), 0), 99999999) else taxa_entrega_centavos end
    where id = p_barraca_id;

  elsif p_etapa = 10 then
    -- Conclui só se os 4 obrigatórios estão de fato preenchidos (conferido no banco, não no cliente).
    if not exists (select 1 from public.horarios_funcionamento where barraca_id = p_barraca_id and aberto)
       or not exists (select 1 from public.barracas where id = p_barraca_id and jsonb_array_length(coalesce(metodos_pagamento_ativos, '[]'::jsonb)) >= 1 and cardinality(modos_atendimento) >= 1) then
      raise exception 'obrigatorios_pendentes';
    end if;
    update public.barracas set onboarding_concluido_em = coalesce(onboarding_concluido_em, now()) where id = p_barraca_id;
  end if;

  update public.barracas set onboarding_etapa = greatest(onboarding_etapa, p_etapa::smallint) where id = p_barraca_id;
  select onboarding_concluido_em into v_concluido from public.barracas where id = p_barraca_id;
  return jsonb_build_object('etapa', p_etapa, 'concluido', v_concluido is not null);
end;
$$;

revoke all on function public.onboarding_salvar_passo(uuid, integer, jsonb) from public, anon;
grant execute on function public.onboarding_salvar_passo(uuid, integer, jsonb) to authenticated;
