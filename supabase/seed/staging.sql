-- Seed FICTÍCIO do staging (projeto qzcqwovbbylqxljcrqhk). NUNCA rodar em produção.
-- Não rode direto: use `npm run staging:seed`, que gera a senha do usuário de
-- teste, troca o marcador __SENHA__ e só executa no projeto de staging.
-- Idempotente: pode rodar de novo sem duplicar.
do $$
begin
  -- Defesa extra contra rodar na produção por engano: o staging só tem dados
  -- fictícios. Aborta se existir qualquer barraca que não seja a de seed, ou
  -- qualquer usuário cujo e-mail não termine em .invalid.
  if exists (select 1 from public.barracas where slug <> 'barraca-teste') then
    raise exception 'Seed abortado: existe barraca que não é a de seed; este banco não parece ser o staging.';
  end if;
  if exists (select 1 from auth.users where email is null or email not like '%.invalid') then
    raise exception 'Seed abortado: existe usuário com e-mail real; este banco não parece ser o staging.';
  end if;
end $$;

do $$
declare
  v_email constant text := 'dono@staging.saiae.invalid';
  v_user uuid;
  v_barraca uuid;
  v_cat_lanches uuid;
  v_cat_bebidas uuid;
begin
  select id into v_user from auth.users where email = v_email;
  if v_user is null then
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
      v_email, extensions.crypt('__SENHA__', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_user, v_user::text,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now());
  end if;

  select id into v_barraca from public.barracas where slug = 'barraca-teste';
  if v_barraca is null then
    insert into public.barracas (nome, slug, modo, verde_ate, amarelo_ate, metodos_pagamento_ativos,
      modos_atendimento, taxa_entrega_habilitada, taxa_entrega_centavos, pagamento_online_habilitado)
    values ('Barraca Teste (staging)', 'barraca-teste', 'claro', 15, 30,
      '["dinheiro","debito","credito","pix"]'::jsonb,
      array['balcao','retirada','entrega'], true, 500, false)
    returning id into v_barraca;
  end if;

  insert into public.usuarios_barracas (usuario_id, barraca_id, papel)
  select v_user, v_barraca, 'dono'
  where not exists (select 1 from public.usuarios_barracas where usuario_id = v_user and barraca_id = v_barraca);

  select id into v_cat_lanches from public.categorias where barraca_id = v_barraca and nome = 'Lanches';
  if v_cat_lanches is null then
    insert into public.categorias (barraca_id, nome, ordem) values (v_barraca, 'Lanches', 1) returning id into v_cat_lanches;
  end if;
  select id into v_cat_bebidas from public.categorias where barraca_id = v_barraca and nome = 'Bebidas';
  if v_cat_bebidas is null then
    insert into public.categorias (barraca_id, nome, ordem) values (v_barraca, 'Bebidas', 2) returning id into v_cat_bebidas;
  end if;

  insert into public.itens (barraca_id, nome, preco_centavos, categoria_id, ativo, ordem, descricao)
  select v_barraca, x.nome, x.preco, x.cat, true, x.ordem, x.descricao
  from (values
    ('X-Teste',        1800, v_cat_lanches, 1, 'Lanche fictício'),
    ('Pastel de Teste', 1200, v_cat_lanches, 2, 'Pastel fictício'),
    ('Combo Teste',    2500, v_cat_lanches, 3, 'Combo fictício'),
    ('Refrigerante',    600, v_cat_bebidas, 4, 'Lata 350 ml'),
    ('Suco de Teste',   900, v_cat_bebidas, 5, 'Suco fictício')
  ) as x(nome, preco, cat, ordem, descricao)
  where not exists (select 1 from public.itens i where i.barraca_id = v_barraca and i.nome = x.nome);

  insert into public.taxas_entrega_bairro (barraca_id, bairro, bairro_normalizado, valor_centavos, ativo)
  select v_barraca, x.bairro, x.norm, x.valor, true
  from (values ('Centro','centro',400), ('Bairro Alto','bairro alto',700), ('Jardim Teste','jardim teste',1000)) as x(bairro, norm, valor)
  where not exists (select 1 from public.taxas_entrega_bairro t where t.barraca_id = v_barraca and t.bairro_normalizado = x.norm);
end $$;
