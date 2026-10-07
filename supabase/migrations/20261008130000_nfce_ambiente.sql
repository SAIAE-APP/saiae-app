-- Ambiente em que a NFC-e foi EMITIDA (homologação não tem valor fiscal).
-- O cupom e o Histórico precisam avisar isso, e não podem usar o
-- barracas.fiscal_ambiente ATUAL: o dono pode trocar o ambiente depois de
-- emitir. emitir-nfce passa a gravar o ambiente usado na chamada.
--
-- Aditiva: coluna nullable, sem default. Nota antiga fica NULL e o app trata
-- assim (conservador): produção só se a barraca estiver hoje em produção,
-- senão homologação. Nenhuma função do banco é alterada.

alter table public.pedidos
  add column if not exists nfce_ambiente text;

alter table public.pedidos
  drop constraint if exists pedidos_nfce_ambiente_valido;
alter table public.pedidos
  add constraint pedidos_nfce_ambiente_valido check (
    nfce_ambiente is null or nfce_ambiente in ('homologacao', 'producao')
  );
