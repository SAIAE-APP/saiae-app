-- IA no WhatsApp, Task 3: o dono liga e desliga o atendente da própria loja. ADITIVA; depende de 20261019100000.
--
-- `ia_ligar(p_barraca_id, p_habilitada)`:
--   * só `authenticated` com acesso à barraca (usuario_tem_acesso_barraca); anon e público não executam;
--   * ligar exige o WhatsApp do dono salvo (é para onde a IA avisa quando precisa dele): senão 'ia_sem_whatsapp_dono';
--   * gera o código do link na PRIMEIRA vez que liga e o MANTÉM depois (desligar e religar não muda o link já
--     impresso em QR/cartaz); nunca gera outro código se já existe;
--   * devolve { ia_habilitada, ia_codigo } para a tela.
-- O texto livre e o WhatsApp do dono são salvos pelo update normal da barraca (RLS do dono), com os limites do banco.
--
-- Rollback: drop function if exists public.ia_ligar(uuid, boolean);

create or replace function public.ia_ligar(p_barraca_id uuid, p_habilitada boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.barracas%rowtype;
  v_codigo text;
begin
  if auth.uid() is null or p_barraca_id is null or not public.usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;

  select * into b from public.barracas where id = p_barraca_id for update;
  if not found then
    raise exception 'sem acesso a esta barraca';
  end if;

  if p_habilitada and b.ia_whatsapp_dono is null then
    raise exception 'ia_sem_whatsapp_dono';
  end if;

  v_codigo := b.ia_codigo;
  if p_habilitada and v_codigo is null then
    v_codigo := public.ia_gerar_codigo();
  end if;

  update public.barracas
     set ia_habilitada = coalesce(p_habilitada, false), ia_codigo = v_codigo
   where id = p_barraca_id;

  return jsonb_build_object('ia_habilitada', coalesce(p_habilitada, false), 'ia_codigo', v_codigo);
end;
$$;

revoke all on function public.ia_ligar(uuid, boolean) from public, anon;
grant execute on function public.ia_ligar(uuid, boolean) to authenticated;
