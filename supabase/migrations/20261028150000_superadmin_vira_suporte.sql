-- Edição do cardápio pelo superadmin, pelo mecanismo do suporte: o dono gera o código de 8 caracteres e a conta
-- redime em `suporte_resgatar_codigo`. Para isso todo superadmin entra também em `usuarios_suporte` (gatilho
-- abaixo). Sair de `superadmins` não tira de `usuarios_suporte`: a conta pode ser suporte por conta própria e a
-- remoção é decisão separada.
--
-- DEPENDE de 20261023100000_acesso_suporte.sql (cria `usuarios_suporte`) e de 20261028100000_admin_planos_prazos.sql
-- (cria `superadmins`). Fica separada da migration de abrir barraca porque a produção ainda não tem o acesso do
-- suporte: aplicar esta antes dele falha.

create or replace function public.superadmin_vira_suporte()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.usuarios_suporte (usuario_id) values (new.usuario_id) on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.superadmin_vira_suporte() from public, anon, authenticated;

drop trigger if exists superadmins_viram_suporte on public.superadmins;
create trigger superadmins_viram_suporte
after insert on public.superadmins
for each row execute function public.superadmin_vira_suporte();

insert into public.usuarios_suporte (usuario_id)
select s.usuario_id from public.superadmins s
on conflict do nothing;
