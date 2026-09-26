-- Fecha a lacuna descoberta em 2026-09-26: as diferenças Essencial/Pro em
-- src/lib/planos.ts eram só texto de marketing, nada era aplicado no
-- código. Este é o 1º dos 3 limites que o dono do produto pediu pra
-- implementar agora: "1 barraca" no Essencial (os outros dois — histórico
-- de 7 dias e exportar só no Pro — são só frontend, em Historico.tsx).
--
-- Plano 'essencial' já é limitado a 1 barraca por dono; trial e Pro
-- continuam sem limite (trial sempre nasce com plan='pro', ver
-- criar_assinatura_trial em 20260922120000_add_assinaturas_kirvano.sql).
create or replace function public.criar_barraca(p_nome text, p_slug text)
returns public.barracas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := trim(p_nome);
  v_slug text := trim(p_slug);
  v_barraca public.barracas;
  v_plano text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select plan into v_plano from public.assinaturas where usuario_id = auth.uid();

  if v_plano = 'essencial' and exists (
    select 1 from public.usuarios_barracas where usuario_id = auth.uid() and papel = 'dono'
  ) then
    raise exception 'O plano Essencial permite só 1 barraca. Faça upgrade para o Pro pra criar mais.';
  end if;

  if v_nome = '' then
    raise exception 'Nome da barraca não pode ser vazio';
  end if;

  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Endereço inválido — use só letras minúsculas, números e hífen';
  end if;

  if exists (select 1 from public.barracas where slug = v_slug) then
    raise exception 'Esse endereço já está em uso';
  end if;

  insert into public.barracas (
    nome, slug, modo, verde_ate, amarelo_ate, metodos_pagamento_ativos
  )
  values (
    v_nome, v_slug, 'claro', 15, 30,
    '["dinheiro", "debito", "credito", "pix"]'::jsonb
  )
  returning * into v_barraca;

  insert into public.usuarios_barracas (usuario_id, barraca_id, papel)
  values (auth.uid(), v_barraca.id, 'dono');

  return v_barraca;
end;
$$;
