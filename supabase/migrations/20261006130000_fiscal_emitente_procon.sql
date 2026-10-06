-- Frente A (Fiscal/PROCON): dados do emitente, endereço da sede do PROCON,
-- alíquota aproximada de tributos (Lei 12.741) e CPF do consumidor na NFC-e.
--
-- 100% ADITIVA e retrocompatível: só colunas novas, nullable. O app Android
-- v1.8 em campo não conhece nenhuma delas e continua funcionando; nenhuma
-- função é alterada.

-- 1) Emitente e PROCON, por barraca (texto livre; telefone 151 é fixo no app).
alter table public.barracas
  add column if not exists emitente_razao_social text,
  add column if not exists emitente_inscricao_estadual text,
  add column if not exists emitente_telefone text,
  add column if not exists emitente_endereco text,
  add column if not exists procon_endereco text,
  -- Alíquota aproximada de tributos em pontos-base (ex.: 1850 = 18,50%).
  -- A FocusNFe não calcula IBPT sozinha: o dono informa a alíquota e o valor
  -- aproximado sai calculado por item.
  add column if not exists tributos_aprox_bps integer;

alter table public.barracas
  drop constraint if exists barracas_tributos_aprox_bps_valida;
alter table public.barracas
  add constraint barracas_tributos_aprox_bps_valida check (
    tributos_aprox_bps is null or (tributos_aprox_bps >= 0 and tributos_aprox_bps <= 10000)
  );

-- 2) CPF do consumidor (opcional) e valor aproximado de tributos da nota,
-- gravados na emissão pra a reimpressão sair idêntica ao documento emitido.
alter table public.pedidos
  add column if not exists nfce_cpf_consumidor text,
  add column if not exists nfce_tributos_centavos integer;

alter table public.pedidos
  drop constraint if exists pedidos_nfce_cpf_consumidor_valido;
alter table public.pedidos
  add constraint pedidos_nfce_cpf_consumidor_valido check (
    nfce_cpf_consumidor is null or nfce_cpf_consumidor ~ '^[0-9]{11}$'
  );
