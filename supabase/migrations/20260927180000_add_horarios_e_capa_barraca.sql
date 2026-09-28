-- Cardápio Digital: imagem de capa (hero, atrás do logo/nome) e horário
-- de funcionamento por dia da semana — feature nova do zero, pedido de
-- produto 2026-09-27 inspirado num print de Configurações de concorrente.
alter table public.barracas
  add column imagem_capa_url text;

-- Uma linha por dia da semana (0=domingo...6=sábado, mesmo índice de
-- Date.getDay() no client) — a UI de Ajustes sempre trabalha com as 7
-- linhas via upsert (barraca_id, dia_semana), nunca cria/apaga linha
-- avulsa. RLS espelha exatamente `categorias`/`banners_cardapio`
-- (usuario_tem_acesso_barraca).
create table public.horarios_funcionamento (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  aberto boolean not null default false,
  hora_abertura time,
  hora_fechamento time,
  unique (barraca_id, dia_semana)
);

alter table public.horarios_funcionamento enable row level security;

create policy "usuarios veem horarios de suas barracas"
on public.horarios_funcionamento for select
to authenticated
using (usuario_tem_acesso_barraca(barraca_id));

create policy "usuarios inserem horarios em suas barracas"
on public.horarios_funcionamento for insert
to authenticated
with check (usuario_tem_acesso_barraca(barraca_id));

create policy "usuarios editam horarios de suas barracas"
on public.horarios_funcionamento for update
to authenticated
using (usuario_tem_acesso_barraca(barraca_id))
with check (usuario_tem_acesso_barraca(barraca_id));

create policy "usuarios deletam horarios de suas barracas"
on public.horarios_funcionamento for delete
to authenticated
using (usuario_tem_acesso_barraca(barraca_id));

-- Imagem de capa sobe pro bucket `cardapio-fotos` já existente, path
-- {barraca_id}/capa-{...} — mesmo primeiro segmento barraca_id que as
-- policies de storage já checam (ver 20260918120000_add_foto_descricao_itens.sql),
-- nenhuma policy nova de storage é necessária.
