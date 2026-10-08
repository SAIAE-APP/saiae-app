# Cupons por código (Comanda) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono cria cupons com código e o cliente do cardápio digital os usa no Pix ou no "pagar na entrega", com desconto calculado só no servidor, reserva atômica e uso confirmado só com pagamento.

**Architecture:** Tabelas `cupons` e `cupom_usos` mais funções de banco (`cupom_avaliar`, `cupom_reservar`, `cupom_confirmar`, `cupom_liberar`) que concentram TODA a regra, executáveis só pelo papel de serviço. Edge functions existentes (`criar-pagamento-pix`, `webhook-mercadopago`, `criar-pedido-cardapio`) chamam essas funções; uma função nova `cupom-validar` só consulta para a tela. Front: campo no carrinho do cardápio e seção "Cupons" em Ajustes.

**Tech Stack:** Postgres/Supabase (migrations, RPC), Deno edge functions, React + Vite + TypeScript, testes Node (`npm test`, `node:test`), scripts de teste contra o staging (`qzcqwovbbylqxljcrqhk`).

**Spec:** `docs/superpowers/specs/2026-10-08-cupons-design.md`

## Global Constraints

- Branch por tarefa a partir de `origin/main`; PR; nada aplicado em produção (migrations, functions, flags) sem ordem explícita do dono. Staging sempre com `--project-ref qzcqwovbbylqxljcrqhk` explícito; nunca `--linked` na pasta do dono.
- Valores em centavos inteiros. O app envia só o `cupom_codigo`; o desconto nunca vem do cliente.
- Desconto só sobre os itens; a taxa de entrega nunca é descontada. Itens cobrados nunca abaixo de 100 centavos.
- Funções de reserva/confirmação/liberação/avaliação: `revoke ... from public, anon, authenticated` (só papel de serviço). Única pública: `cupom_config(slug)` (booleano).
- `barracas.cupons_habilitado` default `false`. Lojas sem a flag: comportamento idêntico ao de hoje.
- Migrations aditivas, nome `2026101800NNNN_*.sql`; evitar a palavra do papel de serviço em prosa nos commits (o hook de pré-commit bloqueia); grant/revoke são aceitos.
- Texto ao usuário em português simples. Alvos de toque de 44 px. Sem cor nova (IDV Sai aê).
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; PRs terminam com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Review Focus

1. Último cupom disputado por dois clientes ao mesmo tempo (exatamente um vence). Teste na Task 2.
2. Cliente muda cupom ou carrinho depois de gerar o Pix (reserva antiga liberada, sem vazar uso). Task 4.
3. Pix aprovado depois de o cupom vencer, ser pausado ou a reserva expirar: o pagamento NÃO pode ser recusado; confirma mesmo assim. Task 5.
4. Percentual/valor fixo que deixaria os itens abaixo de R$ 1,00. Task 2.
5. Webhook duplicado ou "aprovado" depois de "expirado": confirma uma só vez e não perde o pedido. Task 5.

---

### Task 1: Tabelas, flag e `cupom_config`

**Files:**
- Create: `supabase/migrations/20261018100000_cupons.sql`
- Create: `tests/cuponsMigration.test.ts` (estático, no estilo de `tests/perfilClienteMigration.test.ts`)

**Interfaces:**
- Produces: tabelas `cupons`, `cupom_usos`, `cupom_tentativas_log`; colunas `barracas.cupons_habilitado`, `pagamentos_pendentes.{cupom_id,desconto_cupom_centavos,cupom_uso_id}`, `pedidos.{cupom_id,cupom_codigo,desconto_cupom_centavos}`; RPC pública `cupom_config(p_slug text) returns table(habilitado boolean)`.

- [ ] **Step 1: Escrever o teste estático que falha** — lê a migration e confere: RLS ligada nas 3 tabelas; `unique (barraca_id, codigo)`; checks de `tipo`, `valor`, janela de datas; revoke de tudo para `anon, authenticated` em `cupom_usos` e `cupom_tentativas_log`; `cupom_config` com `grant execute ... to anon`; `cupons_habilitado ... default false`.
- [ ] **Step 2: Rodar `npm test`** e ver falhar (arquivo ausente).
- [ ] **Step 3: Escrever a migration**

```sql
alter table public.barracas add column if not exists cupons_habilitado boolean not null default false;

create table public.cupons (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  codigo text not null check (codigo ~ '^[A-Z0-9_-]{3,20}$'),
  tipo text not null check (tipo in ('percentual','fixo')),
  valor integer not null check (valor > 0),
  inicio_em timestamptz,
  fim_em timestamptz,
  limite_usos integer check (limite_usos is null or limite_usos > 0),
  uma_por_cliente boolean not null default false,
  pedido_minimo_centavos integer not null default 0 check (pedido_minimo_centavos >= 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  constraint cupons_percentual_ate_100 check (tipo <> 'percentual' or valor <= 100),
  constraint cupons_janela check (fim_em is null or inicio_em is null or fim_em > inicio_em),
  unique (barraca_id, codigo)
);
alter table public.cupons enable row level security;
create policy cupons_dono_select on public.cupons for select using (public.usuario_tem_acesso_barraca(barraca_id));
create policy cupons_dono_insert on public.cupons for insert with check (public.usuario_tem_acesso_barraca(barraca_id));
create policy cupons_dono_update on public.cupons for update using (public.usuario_tem_acesso_barraca(barraca_id)) with check (public.usuario_tem_acesso_barraca(barraca_id));
-- Sem DELETE direto: cupom com uso só pausa. A exclusão sem uso vai pela rpc `cupom_apagar` (Task 2).

create table public.cupom_usos (
  id uuid primary key default gen_random_uuid(),
  cupom_id uuid not null references public.cupons(id) on delete restrict,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  cliente_id uuid references public.clientes_finais(id) on delete set null,
  pagamento_pendente_id uuid references public.pagamentos_pendentes(id) on delete set null,
  pedido_id uuid references public.pedidos(id) on delete set null,
  estado text not null check (estado in ('reservado','confirmado','liberado')),
  desconto_centavos integer not null check (desconto_centavos >= 0),
  reservado_ate timestamptz not null,
  criado_em timestamptz not null default now()
);
create unique index cupom_usos_pendente_uq on public.cupom_usos (pagamento_pendente_id) where pagamento_pendente_id is not null;
create index cupom_usos_cupom_estado on public.cupom_usos (cupom_id, estado);
create index cupom_usos_cliente on public.cupom_usos (cupom_id, cliente_id) where cliente_id is not null;
alter table public.cupom_usos enable row level security;
revoke all on public.cupom_usos from anon, authenticated;

create table public.cupom_tentativas_log (
  id bigserial primary key,
  barraca_id uuid not null,
  ip_hash text not null,
  valida boolean not null,
  criado_em timestamptz not null default now()
);
create index cupom_tentativas_busca on public.cupom_tentativas_log (barraca_id, ip_hash, criado_em);
alter table public.cupom_tentativas_log enable row level security;
revoke all on public.cupom_tentativas_log from anon, authenticated;

alter table public.pagamentos_pendentes
  add column if not exists cupom_id uuid references public.cupons(id),
  add column if not exists desconto_cupom_centavos integer not null default 0,
  add column if not exists cupom_uso_id uuid references public.cupom_usos(id);
alter table public.pedidos
  add column if not exists cupom_id uuid references public.cupons(id) on delete set null,
  add column if not exists cupom_codigo text,
  add column if not exists desconto_cupom_centavos integer not null default 0;

create or replace function public.cupom_config(p_slug text)
returns table (habilitado boolean) language sql security definer set search_path = public stable as $$
  select b.cupons_habilitado from public.barracas b where b.slug = p_slug and b.cupons_habilitado;
$$;
grant execute on function public.cupom_config(text) to anon, authenticated;
```

- [ ] **Step 4: Rodar o teste** (`npm test`) e ver passar.
- [ ] **Step 5: Aplicar no staging** (`supabase db push --project-ref qzcqwovbbylqxljcrqhk`, conferir com `node scripts/staging.mjs list`).
- [ ] **Step 6: Commit** `feat(cupons): tabelas, flag por loja e cupom_config`.

---

### Task 2: Regras no banco (avaliar, reservar, confirmar, liberar) e limite de tentativas

**Files:**
- Create: `supabase/migrations/20261018110000_cupons_regras.sql`
- Create: `tests/cuponsRegras.staging.mjs` (script contra o staging, no estilo dos testes do perfil; roda manualmente) e `tests/cuponsRegrasMigration.test.ts` (estático: revokes, `for update`, teto de 100)

**Interfaces:**
- Consumes: tabelas da Task 1.
- Produces (todas só para o papel de serviço):
  - `cupom_reservar(p_barraca_id uuid, p_codigo text, p_subtotal_centavos int, p_cliente_id uuid, p_pendente_id uuid, p_reservado_ate timestamptz) returns jsonb` → `{ok:true, uso_id, cupom_id, codigo, desconto_centavos}` ou `{ok:false, erro:'invalido'|'venceu'|'nao_comecou'|'minimo'|'esgotou'|'ja_usou'|'precisa_login', minimo_centavos?}`. Reaproveita a reserva existente do mesmo `p_pendente_id` (idempotente); se o cupom mudou, libera a antiga e cria nova.
  - `cupom_avaliar(p_barraca_id, p_codigo, p_subtotal_centavos, p_cliente_id) returns jsonb` (mesma regra, **sem** gravar e sem travar; usado pela tela).
  - `cupom_confirmar(p_uso_id uuid, p_pedido_id uuid) returns void` — marca `confirmado` e grava `cupom_id/cupom_codigo/desconto_cupom_centavos` em `pedidos`. Confirma mesmo se a reserva já venceu ou foi liberada (pagamento aprovado vale mais que a validade). Segunda chamada é no-op.
  - `cupom_liberar(p_pendente_id uuid) returns void` — `reservado` vira `liberado` (nunca mexe em `confirmado`).
  - `cupom_registrar_tentativa(p_barraca_id uuid, p_ip_hash text, p_valida boolean) returns boolean` — grava e devolve `false` se passou de 15 inválidas/h por IP+loja ou 100 inválidas/h por loja.
  - `cupom_apagar(p_cupom_id uuid) returns void` — só para o dono (`usuario_tem_acesso_barraca`), só se não houver uso; `grant ... to authenticated`.

- [ ] **Step 1: Escrever o script de staging que falha** com os casos: último uso disputado por 10 chamadas paralelas de `cupom_reservar` (exatamente 1 `ok`); mínimo; validade nas bordas; percentual com `floor` (subtotal 999, 10% → 99); teto (subtotal 500, fixo 450 → desconto 400); `ja_usou` com reserva vigente e com confirmado; `precisa_login` sem cliente; reserva vencida não conta; `cupom_liberar` devolve a vaga; `cupom_confirmar` depois de liberada ainda confirma; mesma `p_pendente_id` duas vezes → 1 uso; código igual em duas lojas não se cruza; 16ª tentativa inválida do mesmo IP → `false`.
- [ ] **Step 2: Rodar contra o staging** e ver falhar (funções não existem).
- [ ] **Step 3: Escrever a migration.** Núcleo de `cupom_reservar`:

```sql
create or replace function public.cupom_reservar(
  p_barraca_id uuid, p_codigo text, p_subtotal_centavos integer, p_cliente_id uuid,
  p_pendente_id uuid, p_reservado_ate timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.cupons; v_usos integer; v_desc integer; v_uso uuid; v_agora timestamptz := now();
begin
  select * into c from public.cupons
   where barraca_id = p_barraca_id and codigo = upper(btrim(p_codigo))
     and exists (select 1 from public.barracas b where b.id = p_barraca_id and b.cupons_habilitado)
   for update;                                   -- trava: serializa a disputa pelo último uso
  if not found or not c.ativo then return jsonb_build_object('ok', false, 'erro', 'invalido'); end if;

  -- reserva já feita para esta cobrança: se for do mesmo cupom, reaproveita; senão libera
  select id into v_uso from public.cupom_usos
   where pagamento_pendente_id = p_pendente_id and estado = 'reservado';
  if v_uso is not null then
    if (select cupom_id from public.cupom_usos where id = v_uso) = c.id then
      return jsonb_build_object('ok', true, 'uso_id', v_uso, 'cupom_id', c.id, 'codigo', c.codigo,
        'desconto_centavos', (select desconto_centavos from public.cupom_usos where id = v_uso));
    end if;
    update public.cupom_usos set estado = 'liberado' where id = v_uso;
  end if;

  if c.inicio_em is not null and v_agora < c.inicio_em then return jsonb_build_object('ok', false, 'erro', 'nao_comecou'); end if;
  if c.fim_em is not null and v_agora > c.fim_em then return jsonb_build_object('ok', false, 'erro', 'venceu'); end if;
  if p_subtotal_centavos < c.pedido_minimo_centavos then
    return jsonb_build_object('ok', false, 'erro', 'minimo', 'minimo_centavos', c.pedido_minimo_centavos);
  end if;
  if c.limite_usos is not null then
    select count(*) into v_usos from public.cupom_usos
     where cupom_id = c.id and (estado = 'confirmado' or (estado = 'reservado' and reservado_ate > v_agora));
    if v_usos >= c.limite_usos then return jsonb_build_object('ok', false, 'erro', 'esgotou'); end if;
  end if;
  if c.uma_por_cliente then
    if p_cliente_id is null then return jsonb_build_object('ok', false, 'erro', 'precisa_login'); end if;
    if exists (select 1 from public.cupom_usos where cupom_id = c.id and cliente_id = p_cliente_id
                and (estado = 'confirmado' or (estado = 'reservado' and reservado_ate > v_agora))) then
      return jsonb_build_object('ok', false, 'erro', 'ja_usou');
    end if;
  end if;

  v_desc := case c.tipo when 'percentual' then (p_subtotal_centavos * c.valor) / 100 else c.valor end;
  v_desc := greatest(0, least(v_desc, p_subtotal_centavos - 100));   -- itens cobrados >= R$ 1,00

  insert into public.cupom_usos (cupom_id, barraca_id, cliente_id, pagamento_pendente_id, estado, desconto_centavos, reservado_ate)
  values (c.id, p_barraca_id, p_cliente_id, p_pendente_id, 'reservado', v_desc, p_reservado_ate)
  returning id into v_uso;
  return jsonb_build_object('ok', true, 'uso_id', v_uso, 'cupom_id', c.id, 'codigo', c.codigo, 'desconto_centavos', v_desc);
end $$;
revoke all on function public.cupom_reservar(uuid,text,integer,uuid,uuid,timestamptz) from public, anon, authenticated;
```

  `cupom_avaliar` é a mesma sequência sem `for update` e sem `insert` (extrair o bloco comum em função interna `cupom_regras(...)` que devolve o desconto ou o erro, usada pelas duas). `cupom_confirmar`, `cupom_liberar`, `cupom_registrar_tentativa` e `cupom_apagar` são curtas e seguem as interfaces acima; todas com `revoke` (exceto `cupom_apagar`, com `grant ... to authenticated`).
- [ ] **Step 4: Aplicar no staging e rodar o script** até todos os casos passarem (incluindo os 10 paralelos).
- [ ] **Step 5: Commit** `feat(cupons): regras de reserva, confirmação e limite de tentativas no banco`.

---

### Task 3: Função `cupom-validar` e módulo compartilhado

**Files:**
- Create: `supabase/functions/_shared/cupom.ts` (normalizar código, mapa erro→mensagem, tipos)
- Create: `supabase/functions/cupom-validar/index.ts`
- Test: `tests/cupomShared.test.ts`

**Interfaces:**
- Produces: `normalizarCodigo(texto: string): string | null` (maiúsculas, tira espaços das pontas, valida `^[A-Z0-9_-]{3,20}$`); `mensagemDoErro(erro: string, minimoCentavos?: number): string` com os textos da spec ("Cupom inválido", "Este cupom venceu", "Este cupom ainda não começou", "Vale a partir de R$ X,XX em itens", "Este cupom esgotou", "Você já usou este cupom", "Entre com seu telefone para usar este cupom"). `cupom-validar` recebe `{barraca_slug, codigo, itens, sessao_token?}`, resolve o carrinho com `resolver_carrinho` (nunca confia em preço do cliente), identifica o cliente pelo token se houver, registra a tentativa (`cupom_registrar_tentativa` com `ip_hash`), e devolve `{ok, desconto_centavos, subtotal_centavos, total_itens_centavos}` ou `{ok:false, erro, mensagem}` (429 no limite).

- [ ] **Step 1: Testes de `cupom.ts`** (minúsculas viram maiúsculas; espaços nas pontas saem; `ab`, 21 caracteres e `FE IRA` retornam null; cada código de erro tem mensagem; mínimo formata `R$ 30,00`). Rodar e ver falhar.
- [ ] **Step 2: Implementar `cupom.ts`**; rodar e ver passar.
- [ ] **Step 3: Implementar `cupom-validar`** reaproveitando o padrão de `cliente-pedir-codigo` para CORS, `ip_hash` com `CLIENTE_HASH_PEPPER` e resolução de sessão; sem JWT.
- [ ] **Step 4: Publicar no staging** (`supabase functions deploy cupom-validar --no-verify-jwt --project-ref qzcqwovbbylqxljcrqhk`) e testar com curl: cupom válido, inválido, vencido, e a 16ª tentativa inválida (429).
- [ ] **Step 5: Commit** `feat(cupons): função cupom-validar`.

---

### Task 4: Cupom no Pix (`criar-pagamento-pix`)

**Files:**
- Modify: `supabase/functions/criar-pagamento-pix/index.ts` (corpo aceita `cupom_codigo?: string | null`; resposta devolve `desconto_cupom_centavos`)
- Test: `tests/cuponsPix.staging.mjs`

**Interfaces:**
- Consumes: `cupom_reservar`, `cupom_liberar`, `normalizarCodigo`, `mensagemDoErro`.
- Produces: `total cobrado = totalCentavos - desconto + taxaEntrega`; `pagamentos_pendentes.{cupom_id,desconto_cupom_centavos,cupom_uso_id}` preenchidos; resposta com `total_centavos` já descontado.

- [ ] **Step 1: Teste de staging que falha:** pedido com cupom gera Pix com o total descontado; `total_esperado_centavos` antigo (sem desconto) recebe "valor mudou"; cupom inválido retorna a mensagem do mapa sem criar cobrança; retry com mesmo `client_uuid` e mesmo cupom reaproveita a reserva (1 linha em `cupom_usos`); trocar o código libera a reserva anterior; sem `cupom_codigo` o fluxo é idêntico ao atual.
- [ ] **Step 2: Implementar.** Depois de `resolver_carrinho` e do cálculo da taxa, se houver `cupom_codigo`: normalizar, criar o `pagamentos_pendentes` (como já ocorre) e chamar `cupom_reservar` com `p_pendente_id`, `p_reservado_ate` = mesmo `expira_em` do Pix, `p_cliente_id` vindo da sessão; em `ok:false` não deixar cobrança órfã e responder `{erro: mensagem}` 422; em `ok:true` subtrair o desconto do total, gravar nos campos do pendente e validar `total_esperado_centavos` contra o total **com** desconto. Se a criação da cobrança no provedor falhar depois da reserva, chamar `cupom_liberar`.
- [ ] **Step 3: Publicar no staging e rodar o script** até passar. Conferir que a regressão existente continua verde (`npm test`).
- [ ] **Step 4: Commit** `feat(cupons): desconto no Pix com reserva do cupom`.

---

### Task 5: Confirmação e liberação (webhook e "pagar na entrega")

**Files:**
- Modify: `supabase/functions/webhook-mercadopago/index.ts`, `supabase/functions/criar-pedido-cardapio/index.ts`
- Test: `tests/webhookCupom.test.ts` (unidade, no estilo de `tests/webhookCorrida.test.ts`) e `tests/cuponsWebhook.staging.mjs`

**Interfaces:**
- Consumes: `cupom_confirmar`, `cupom_liberar`.

- [ ] **Step 1: Testes que falham:** (a) `aprovado` com `cupom_uso_id` chama `cupom_confirmar(uso, pedido)` uma vez e `pedidos.desconto_cupom_centavos` fica gravado; (b) webhook duplicado e a corrida 23505 não confirmam duas vezes (segunda chamada é no-op); (c) `aprovado` quando a reserva já venceu ou foi liberada ainda confirma e o pedido existe; (d) `expirado`/`rejeitado` chama `cupom_liberar`; (e) `expirado` seguido de `aprovado` não perde o pedido; (f) "pagar na entrega" com cupom: reserva curta, `criar_pedido`, `cupom_confirmar`; falha em `criar_pedido` libera.
- [ ] **Step 2: Implementar** os pontos de chamada. O valor enviado ao `criar_pedido` continua sendo itens + taxa; o desconto vai por `cupom_confirmar` (que grava em `pedidos`). Garantir que a conferência do valor pago no webhook use o valor do pendente (que já é o descontado).
- [ ] **Step 3: Publicar no staging e rodar os scripts** (Pix simulado como nos testes anteriores do staging); `npm test`.
- [ ] **Step 4: Commit** `feat(cupons): confirma o uso no pagamento e libera ao expirar`.

---

### Task 6: Cliente — campo "Tem cupom?" no cardápio

**Files:**
- Create: `src/lib/cupomApi.ts` (`validarCupom({slug, codigo, itens, token}): Promise<ResultadoCupom>`, `cupomConfig(slug): Promise<boolean>` com a mesma detecção de função ausente de `perfilDisponivel.ts`)
- Create: `src/components/CampoCupom.tsx`
- Modify: `src/pages/CardapioPublico.tsx` (resumo do carrinho, envio do `cupom_codigo` em `criar-pagamento-pix`/`criar-pedido-cardapio`, total esperado com desconto)
- Test: `tests/cupomApi.test.ts` (módulo puro: monta o corpo, traduz resposta, trata função ausente como desligado)

- [ ] **Step 1: Testes que falham** de `cupomApi.ts` (função ausente = desligado; resposta ok → desconto e novo total; erro → mensagem; nenhum campo de desconto é enviado no corpo, só o código).
- [ ] **Step 2: Implementar** `cupomApi.ts` e rodar os testes.
- [ ] **Step 3: Implementar `CampoCupom`** (link "Tem cupom?" → campo + botão "Aplicar"; mostra "Cupom FEIRA10: −R$ 5,00", botão "Remover"; mensagens de erro; botões ≥ 44 px) e ligar no `CardapioPublico` só quando `cupomConfig` for verdadeiro. Revalidar quando o carrinho mudar; se o cupom deixar de valer, avisar e remover.
- [ ] **Step 4: `npm run build` e `npm test`**; conferir visualmente em 375 px no staging (aplicar, erro, remover, total no botão do Pix).
- [ ] **Step 5: Commit** `feat(cupons): campo de cupom no cardápio digital`.

---

### Task 7: Dono — seção "Cupons" em Ajustes

**Files:**
- Create: `src/lib/cupons.ts` (tipos, `validarFormularioCupom`, selo `Ativo|Pausado|Vencido|Esgotado`, texto "−10%"/"−R$ 5,00")
- Create: `src/components/SecaoCupons.tsx`, `src/components/BottomSheetCupom.tsx`
- Create: `supabase/migrations/20261018120000_cupons_painel.sql` (RPC `cupons_resumo(p_barraca_id uuid)`, autenticada, checa `usuario_tem_acesso_barraca`, devolve por cupom `usos_confirmados` e `desconto_total_centavos`; `cupom_usos` não tem policy de leitura)
- Modify: `src/pages/Ajustes.tsx` (categoria **Cardápio & Operação**, wrapper `display: contents` como as outras seções)
- Test: `tests/cupons.test.ts`

- [ ] **Step 1: Testes que falham** de `cupons.ts`: código normaliza para maiúsculas e recusa inválido; percentual 1–100; fixo > 0; `fim` depois do `início`; limite e mínimo inteiros ≥ 0; selos (vencido por `fim_em`, esgotado por `usos >= limite`); "uma vez por cliente" recusado quando a loja não usa perfil.
- [ ] **Step 2: Implementar `cupons.ts`** e passar os testes.
- [ ] **Step 3: Migration `cupons_resumo`** aplicada no staging; teste de que outro dono não enxerga os números.
- [ ] **Step 4: Implementar a seção:** toggle `cupons_habilitado` (salva na hora, reverte e avisa se falhar, padrão de `SecaoPagarNaEntrega`); lista com código, desconto, validade, usos `confirmados/limite`, total de desconto dado; formulário único com botão Salvar explícito (padrão `BotaoSalvarCampo`/`BottomSheetItem`); Pausar/Reativar; Apagar só sem uso (`cupom_apagar`); erro de código repetido ("Já existe um cupom com esse código").
- [ ] **Step 5: `npm run build`, `npm test`, conferir em 375 px e em desktop.**
- [ ] **Step 6: Commit** `feat(cupons): seção Cupons em Ajustes`.

---

### Task 8: Onde o desconto aparece (pedido, relatórios, nota fiscal, evento)

**Files:**
- Modify: `src/pages/Cozinha.tsx` / `src/components/DetalheComanda.tsx` / cartão do Histórico (linha "Cupom X: −R$ Y"), `src/lib/relatorio.ts` e `src/components/SecaoRelatorio.tsx` (linha "Descontos de cupom", coluna na planilha, líquido = bruto − descontos), consulta dos pedidos para trazer `cupom_codigo` e `desconto_cupom_centavos`
- Create: `supabase/functions/_shared/descontoNfce.ts` (`ratearDesconto(itens, desconto)`)
- Modify: `supabase/functions/emitir-nfce/index.ts` (valor da nota = itens − desconto; rateio proporcional por item, resto no último; campo de desconto por item da FocusNFe **confirmado na documentação antes de codar**; taxa continua fora)
- Create: `supabase/migrations/20261018130000_evento_cupom.sql` (redefine `montar_evento_saida` acrescentando `cupom_codigo` e `desconto_cupom_centavos` opcionais, partindo da definição mais recente em `20261017140000`)
- Test: `tests/relatorioCupom.test.ts`, `tests/nfceDesconto.test.ts` (rateio: soma exata, resto no último, nunca negativo), `tests/eventoCupom.test.ts` (estático + staging)

- [ ] **Step 1: Testes que falham** de rateio e de totais do relatório (bruto, descontos, líquido; pedido sem cupom inalterado).
- [ ] **Step 2: Implementar** `ratearDesconto` e usá-la em `emitir-nfce`; passar os testes.
- [ ] **Step 3: Implementar** relatório e linhas nos cards; aplicar a migration do evento no staging e conferir o evento de um pedido com cupom.
- [ ] **Step 4: Documentar no `emitir-nfce`** que a primeira emissão real com desconto precisa ser conferida contra o resultado bruto da FocusNFe.
- [ ] **Step 5: `npm run build`, `npm test`; commit** `feat(cupons): desconto no pedido, relatório, nota e evento`.

---

### Task 9: Ponta a ponta no staging, revisão e liberação

**Files:**
- Create: `tests/cuponsE2E.staging.mjs`
- Modify: `CLAUDE.md` (seção "Regras de produto": cupons, de forma curta, com a decisão do desconto só nos itens, uso confirmado no pagamento e teto de R$ 1,00)

- [ ] **Step 1: Roteiro de staging** (com `CODIGO_SIMULADO` e Pix simulado como nos testes do perfil): criar cupom → cliente aplica → Pix com valor descontado → webhook aprovado → pedido com `desconto_cupom_centavos` → uso confirmado → mesma pessoa tenta de novo com "uma vez por cliente" → `ja_usou`; Pix que expira libera; relatório mostra a linha; evento do pedido leva os campos.
- [ ] **Step 2: Todos os PRs verdes**; pedir **revisão independente** à aorus-19 com foco nos 5 itens de Review Focus; corrigir tudo que for bloqueio ou importante.
- [ ] **Step 3: Relatório para o dono** com os testes que ele executa na loja de teste (criar cupom, aplicar, pagar Pix de valor baixo, ver no relatório). **Não aplicar nada em produção**; esperar ordem do dono. Na liberação: `supabase db push` (4 migrations), publicar `cupom-validar`, `criar-pagamento-pix`, `webhook-mercadopago`, `criar-pedido-cardapio`, `emitir-nfce`, ligar `cupons_habilitado` só em `qa-teste-varredura`.
- [ ] **Step 4: Commit** `docs(cupons): regras de cupom no CLAUDE.md`.
