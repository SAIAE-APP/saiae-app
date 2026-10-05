-- Telefone de cliente final numa forma só: dígitos, sem o 55 do país.
-- "11 91234-5678", "+55 11 91234-5678" e "5511912345678" são o mesmo cliente;
-- sem isso a chave única (barraca_id, telefone) criava dois cadastros.
--
-- O app já normaliza antes de gravar (src/lib/entrega.ts, normalizarTelefone).
-- Este trigger garante o mesmo no banco, inclusive pra versão antiga do app
-- ainda em cache no aparelho. BEFORE INSERT/UPDATE roda antes da checagem de
-- conflito do upsert, então o ON CONFLICT (barraca_id, telefone) enxerga o
-- valor já normalizado.
--
-- Regra do 55: só sai quando sobram 12 ou 13 dígitos (55 + DDD + número).
-- Com 10 ou 11 dígitos o "55" é o DDD de Santa Maria/RS e fica.

create or replace function public.normalizar_telefone_cliente_final()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_digitos text := regexp_replace(coalesce(new.telefone, ''), '\D', '', 'g');
begin
  if length(v_digitos) in (12, 13) and left(v_digitos, 2) = '55' then
    v_digitos := substr(v_digitos, 3);
  end if;
  new.telefone := v_digitos;
  return new;
end;
$$;

drop trigger if exists clientes_finais_normalizar_telefone on public.clientes_finais;
create trigger clientes_finais_normalizar_telefone
  before insert or update of telefone on public.clientes_finais
  for each row execute function public.normalizar_telefone_cliente_final();

-- Cadastros que já existissem com 55 (a tabela estava vazia quando isto foi
-- escrito). Se o mesmo cliente já tem a versão sem 55, fica o mais recente.
-- 1) versão sem 55 mais antiga que a versão com 55: apaga a sem 55.
delete from public.clientes_finais b
 using public.clientes_finais a
 where a.barraca_id = b.barraca_id
   and length(a.telefone) in (12, 13)
   and left(a.telefone, 2) = '55'
   and b.telefone = substr(a.telefone, 3)
   and b.atualizado_em < a.atualizado_em;

-- 2) o que sobrar da versão com 55 que já tem par sem 55 (par mais novo): apaga.
delete from public.clientes_finais a
 using public.clientes_finais b
 where a.barraca_id = b.barraca_id
   and length(a.telefone) in (12, 13)
   and left(a.telefone, 2) = '55'
   and b.telefone = substr(a.telefone, 3)
   and a.atualizado_em <= b.atualizado_em;

update public.clientes_finais
   set telefone = substr(telefone, 3)
 where length(telefone) in (12, 13)
   and left(telefone, 2) = '55';
