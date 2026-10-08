-- IA no WhatsApp: o dono não liga a IA nem escolhe o código do link fora de `ia_ligar`. ADITIVA; depende de
-- 20261019100000 (colunas) e 20261019110000 (ia_ligar).
--
-- Sem isto, a RLS de `barracas` deixaria o dono editar `ia_habilitada` e `ia_codigo` direto: ligaria a IA sem o
-- WhatsApp do dono (para onde ela avisa) ou escolheria o próprio código. Não expõe dado de ninguém, mas quebra a
-- regra da tela.
--
-- Regra (trigger BEFORE INSERT/UPDATE em `barracas`):
--   * quem chega pela API com o login do usuário (current_user = authenticated ou anon) NÃO pode criar nem mudar
--     `ia_habilitada` e `ia_codigo`; tentativa de mudar é recusada com 'ia_use_a_tela';
--   * o papel de serviço, a migration e as funções SECURITY DEFINER (como `ia_ligar`, cujo current_user é o dono da
--     função) continuam podendo;
--   * para TODOS: com a IA ligada, o WhatsApp do dono não pode ficar vazio ('ia_sem_whatsapp_dono').
-- `ia_texto_livre` e `ia_whatsapp_dono` seguem editáveis pelo dono (a tela salva por update normal).
--
-- Rollback: drop trigger if exists barracas_ia_proteger on public.barracas;
--           drop function if exists public.barracas_ia_proteger();

create or replace function public.barracas_ia_proteger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if coalesce(new.ia_habilitada, false) or new.ia_codigo is not null then
        raise exception 'ia_use_a_tela';
      end if;
    elsif new.ia_habilitada is distinct from old.ia_habilitada or new.ia_codigo is distinct from old.ia_codigo then
      raise exception 'ia_use_a_tela';
    end if;
  end if;

  if new.ia_habilitada and new.ia_whatsapp_dono is null then
    raise exception 'ia_sem_whatsapp_dono';
  end if;

  return new;
end;
$$;

drop trigger if exists barracas_ia_proteger on public.barracas;
create trigger barracas_ia_proteger
  before insert or update on public.barracas
  for each row execute function public.barracas_ia_proteger();
