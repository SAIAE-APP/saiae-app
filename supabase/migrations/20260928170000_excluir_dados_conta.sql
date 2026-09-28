-- Exclusão de conta self-service (Ajustes > Excluir minha conta). Esta função
-- só apaga os DADOS do usuário no schema public; quem apaga o login em
-- auth.users é a edge function `excluir-conta` (auth.admin.deleteUser exige
-- service role — SQL direto em auth.users não é o caminho suportado).
--
-- Decisões (conservadoras de propósito, nunca apagar dado de OUTRO usuário):
--  * Barraca em que o usuário é o ÚNICO dono: apagada por completo (mesma
--    lista de apagar_barraca + tabelas criadas depois: caixas, fiscal,
--    pagamento online, banners, horários).
--  * Barraca com OUTRO dono: NÃO é apagada — só o vínculo deste usuário sai.
--  * Funcionário (papel <> 'dono'): só o vínculo dele sai; a barraca fica.
--  * contas_trial_usadas NÃO é apagada de propósito: é o registro
--    anti-abuso de trial (1 por e-mail), já documentado como "nunca apagado".
--  * Assinatura Kirvano não é cancelada aqui (usuário cancela à parte,
--    como orienta /excluir-conta); a linha em `assinaturas` some junto.
--
-- Devolve os ids das barracas apagadas pra edge function limpar o Storage
-- (buckets cardapio-fotos e logo-barraca usam {barraca_id}/ como pasta).
create or replace function public.excluir_dados_conta(p_usuario_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barracas uuid[];
  v_barraca uuid;
begin
  if p_usuario_id is null then
    raise exception 'Usuário obrigatório';
  end if;

  select coalesce(array_agg(ub.barraca_id), '{}')
  into v_barracas
  from public.usuarios_barracas ub
  where ub.usuario_id = p_usuario_id
    and ub.papel = 'dono'
    and not exists (
      select 1 from public.usuarios_barracas outro
      where outro.barraca_id = ub.barraca_id
        and outro.papel = 'dono'
        and outro.usuario_id <> p_usuario_id
    );

  foreach v_barraca in array v_barracas loop
    delete from public.itens_do_pedido
    where pedido_id in (select id from public.pedidos where barraca_id = v_barraca);
    delete from public.pagamentos_pendentes where barraca_id = v_barraca;
    delete from public.pedidos where barraca_id = v_barraca;
    delete from public.banners_cardapio where barraca_id = v_barraca;
    delete from public.horarios_funcionamento where barraca_id = v_barraca;
    delete from public.movimentos_caixa where barraca_id = v_barraca;
    delete from public.caixas where barraca_id = v_barraca;
    delete from public.barracas_fiscal_token where barraca_id = v_barraca;
    delete from public.barracas_pagamento_token where barraca_id = v_barraca;
    delete from public.itens where barraca_id = v_barraca;
    delete from public.categorias where barraca_id = v_barraca;
    delete from public.custos_diarios where barraca_id = v_barraca;
    delete from public.barracas_senha_admin where barraca_id = v_barraca;
    delete from public.usuarios_barracas where barraca_id = v_barraca;
    delete from public.barracas where id = v_barraca;
  end loop;

  -- vínculos restantes: funcionário, ou dono em barraca com outro dono
  delete from public.usuarios_barracas where usuario_id = p_usuario_id;
  delete from public.assinaturas where usuario_id = p_usuario_id;

  return v_barracas;
end;
$$;

-- Só a edge function (service role) chama; nunca o client.
revoke all on function public.excluir_dados_conta(uuid) from public, anon, authenticated;
grant execute on function public.excluir_dados_conta(uuid) to service_role;
