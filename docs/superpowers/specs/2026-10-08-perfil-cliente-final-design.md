# Perfil do cliente final (por loja) — design

Data: 2026-10-08. Fonte: pedido do dono do produto em 2026-10-08 (prioridades: IA no WhatsApp, clientes e cupons; "perfil do cliente final, como a Brendi"). Plano de origem: `PLANO-AGIL-SAIAE.md` (SAI-020, SAI-021, SAI-022, SAI-050). Status: **aguardando revisão do dono do produto.** Nenhum código foi escrito.

## Objetivo
Dar ao cliente final um perfil dentro de cada loja (cadastro, endereços, histórico, "pedir de novo"), com telefone confirmado por código no WhatsApp. O perfil é a base de três entregas em sequência: **perfil → cupons → IA que reconhece o cliente e fecha pedido**.

## Decisões do dono (2026-10-08)
| # | Decisão |
|---|---|
| 1 | Login por **telefone com código enviado por WhatsApp** (sem senha, sem e-mail, sem Google nesta versão). |
| 2 | Perfil **por loja**: o cliente tem um perfil em cada loja onde pede; chave `barraca_id` + telefone. Sem perfil único entre lojas. |
| 3 | No **cardápio digital**, o perfil é **obrigatório só na hora de fechar o pedido**; navegar e montar o carrinho não exige nada. Pedido lançado no balcão pelo operador não muda. |
| 4 | Entrega em fases: **v1 perfil**, **v2 cupons**, depois **IA**. |
| 5 | Arquitetura **A**: login próprio do cliente na Comanda; o CRM só envia o código. Descartado o login nativo do Supabase para clientes (ele criaria assinatura de teste para cada cliente por causa do trigger em `auth.users`). |

## Estado atual (auditado em origin/main, 2026-10-08)
- `clientes_finais`: único por `(barraca_id, telefone)`, **um endereço** (`rua`, `numero`, `bairro` NOT NULL, `referencia`), telefone só com dígitos e sem o 55 (`normalizarTelefone` + trigger), RLS só para o dono (`usuario_tem_acesso_barraca`), consentimento de marketing (migration 20261007140000), importação (20261012100000). Salvo em segundo plano pela fila de sincronização depois do `criar_pedido`.
- `pedidos` guarda cópia de nome/telefone/endereço de entrega (`entrega_*`, `cliente_nome`, `cliente_telefone`); **não** aponta para o cliente.
- O cardápio público cria pedido anônimo pela edge function `criar-pedido-cardapio` (e Pix por `criar-pagamento-pix`).
- Contrato SAI-001 v1 já carrega `cliente.{nome,telefone,consentimento_contato}` nos eventos. O CRM ainda descarta eventos (sem consumidor).
- Pendência registrada: telefone oculto (BSUID) em `docs/pendencias-bsuid-telefone.md`.

## Parte 1 — Dados
Princípio: **evoluir `clientes_finais` para ser o perfil**, sem tabela concorrente. Migrations aditivas, aplicadas no staging antes da produção.

**`clientes_finais` (alterar):**
- `telefone_confirmado_em timestamptz null` — preenchido quando o cliente passa pelo código. Cadastros existentes ficam `null` (não viram "confirmados").
- `aceita_avisos_pedido boolean not null default true` (informativo; aviso de pedido é parte do serviço) e reaproveitar o consentimento de promoções que já existe (`20261007140000`).
- `apagado_em timestamptz null` (soft para a rotina de exclusão; ver Parte 3).
- `rua`, `numero`, `bairro` passam a **nullable**: o perfil pode existir sem endereço (retirada). Os campos antigos continuam sendo o "endereço padrão" para compatibilidade com a Entrega do operador e a importação, até migrar tudo para a tabela de endereços. Nada do fluxo atual quebra.

**`cliente_enderecos` (nova):** `id`, `cliente_id` → `clientes_finais` on delete cascade, `barraca_id`, `apelido` (casa/trabalho/outro), `rua`, `numero`, `bairro`, `referencia`, `padrao boolean`, `criado_em`. No máximo um `padrao` por cliente (índice parcial único). Backfill: cada `clientes_finais` com endereço vira um endereço padrão.

**`cliente_codigos` (nova):** `id`, `barraca_id`, `telefone`, `codigo_hash` (nunca o código), `expira_em` (5 min), `usado_em`, `tentativas` (máx. 5), `ip_hash`, `criado_em`.

**`cliente_sessoes` (nova):** `id`, `cliente_id`, `barraca_id`, `token_hash` (sha-256 do token opaco; o token só existe no aparelho), `expira_em` (30 dias), `ultimo_uso_em`, `aparelho` (texto curto), `revogada_em`.

**`pedidos.cliente_id uuid null`** → `clientes_finais(id)` on delete set null. Histórico = consulta por `cliente_id`. Pedido antigo sem vínculo continua válido. Na exclusão do perfil o pedido fica e **perde** o vínculo e os dados pessoais (anonimiza `cliente_nome`, `cliente_telefone`, `entrega_*`).

As três tabelas novas e `clientes_finais` com RLS ligada; `cliente_codigos` e `cliente_sessoes` **sem nenhuma policy** (só funções SECURITY DEFINER e service role), mesmo padrão de `barracas_pagamento_token`.

## Parte 2 — Fluxo do código por WhatsApp
**Edge functions novas** (sem JWT de usuário; autenticação própria; CORS só do domínio do app):
- `cliente-pedir-codigo` — entrada: `barraca_slug`, `nome`, `telefone`, `honeypot`. Normaliza o telefone, aplica limites (abaixo), cria o código (6 dígitos, `crypto.getRandomValues`), grava o hash, chama o CRM para enviar. Resposta **idêntica** para telefone já cadastrado ou não.
- `cliente-verificar-codigo` — entrada: `barraca_slug`, `telefone`, `codigo`, `aparelho`. Confere hash, expiração, uso único e tentativas. Sucesso: cria ou atualiza o perfil (`telefone_confirmado_em = now()`), cria sessão, devolve o token (única vez).
- `cliente-sessao` — operações do perfil por token: ler perfil/endereços/histórico, editar, "pedir de novo", preferências, sair, **apagar meus dados**. Cada chamada valida o token (hash), a loja e a validade, e **só enxerga** linhas daquele `cliente_id`.

**Chamada Comanda → CRM (contrato, aditivo na v1, PR aprovado pelas duas frentes):** `POST /api/integracao/comanda/v1/codigo-verificacao`, mesmo esquema de assinatura (`X-Saiae-Timestamp`, `X-Saiae-Signature`, HMAC de `timestamp.corpo`, janela de 5 min). Corpo: `{ barraca_id, telefone, codigo, request_id }`. O CRM envia o **modelo de autenticação** (categoria Autenticação, pt_BR, botão "copiar código") pela Cloud API e responde `{ enviado: true }` ou erro. O CRM **não** guarda o código nem o corpo; log só com contagem e código de erro. Idempotência por `request_id`.

**Limites (anti-abuso e custo):** 5 tentativas de código por pedido (depois invalida); 3 pedidos de código por telefone por hora; por aparelho/IP (hash) 10 por hora; teto diário de envios por loja (`barracas.codigos_dia_max`, padrão 100, ajustável pelo dono); honeypot; resposta uniforme. Reenvio só depois de 60 s.

**Falhas:** CRM fora do ar ou erro da Meta → o cliente vê "Não conseguimos enviar o código. Tente de novo", sem criar perfil e sem revelar o motivo; o pedido **não** é concluído sem confirmação. Telefone oculto (BSUID) → não há envio; o pedido segue **sem perfil**, com aviso. Sem SMS de reserva nesta versão.

## Parte 3 — Segurança e privacidade
- **Acesso:** o cliente só acessa o próprio perfil (token → `cliente_id`); o dono só os clientes da própria loja (`usuario_tem_acesso_barraca`); o CRM só recebe o necessário para enviar a mensagem.
- **Segredos:** códigos e tokens só em hash; nenhum código ou token em log, evento ou mensagem de erro; comparação em tempo constante.
- **LGPD:** aceite da política de privacidade da loja no cadastro; "avisos do pedido" sempre ativos (explicados), "promoções" opcional e desmarcado; opt-out a qualquer momento, respeitado pelo CRM; **"Apagar meus dados"** apaga perfil, endereços, sessões e códigos e anonimiza pedidos (a loja mantém valor e itens para contabilidade e nota fiscal); minimização: só nome, telefone e endereço, sem CPF nem data de nascimento.
- **Riscos assumidos:** número reciclado (o código prova só que a pessoa tem o número hoje; mitigação: sessão de 30 dias e perfil sem dado sensível além do endereço); cadastros antigos não viram "confirmados" até passarem pelo código.
- **Revogação:** o cliente pode sair (revoga a sessão); o dono pode excluir um cliente (revoga todas as sessões dele).

## Parte 4 — Telas
Mobile-first, identidade Sai aê (um primário mostarda por tela, toque ≥ 44 px, selos em canto balão), rotas sob `/:slug/...` do cardápio público.
1. **Cardápio:** "Entrar" no topo (ou o nome do cliente logado); nunca obrigatório.
2. **Fechar pedido — seus dados:** nome, telefone, aceite da privacidade, avisos do pedido (explicado) e promoções (opcional). Botão principal "Receber código". Telefone já cadastrado mostra "Que bom te ver de novo".
3. **Código:** 6 campos, "Reenviar" após 60 s, "Trocar número", tentativas restantes.
4. **Endereço (só Entrega):** endereços salvos com um padrão, "Novo endereço". Retirada não mostra.
5. **Meu perfil:** dados, endereços (adicionar, editar, excluir, escolher padrão), **Histórico** com status e **"Pedir de novo"** (avisa item esgotado, removido ou com preço alterado antes de finalizar), preferências de avisos e promoções, "Sair", "Apagar meus dados" (com confirmação).
6. **Dono (Ajustes):** "Clientes de entrega" evolui para **"Clientes"**: telefone confirmado ou não, aceita promoções, excluir (como hoje).

## Fases
- **v1 — Perfil** (esta especificação): dados, código, sessão, perfil, histórico, pedir de novo, tela de Clientes do dono, contrato do código com o CRM.
- **v2 — Cupons** (spec própria): resgate por cliente, limite de uso, aplicação no cardápio público e no Caixa; evento `coupon.redeemed` (já reservado no contrato).
- **v3 — IA:** reconhece o cliente pelo telefone, usa endereços e histórico, fecha pedido com confirmação explícita (ADR-06).

## Dependências
1. **CRM (aorus-03):** endpoint do código e modelo de autenticação **aprovado pela Meta** (prazo que não controlamos; a v1 só vai ao ar com o modelo aprovado). Pode ser desenvolvido em paralelo.
2. Consumidor de eventos do CRM (já priorizado) e o segredo derivado por barraca (2b do handoff) são independentes, mas o endpoint novo reaproveita a mesma assinatura.
3. Telefone oculto (BSUID): fora do escopo; regra de fallback definida (pedido sem perfil).

## Testes
- Unitários: normalização de telefone, hash, geração e expiração do código, limites, anonimização.
- Banco: RLS (cliente não lê outro cliente nem outra loja), unicidade, exclusão e anonimização, backfill de endereços.
- Staging: fluxo completo com **código simulado** (sem WhatsApp), corrida de dois verificadores, sessão vencida, revogação. Depois envio real na barraca de teste. Nada em produção antes disso.
- Contrato: teste do endpoint do CRM com assinatura válida, inválida e janela expirada.

## Fora de escopo
Login por Google/e-mail/senha; perfil entre lojas; CPF e data de nascimento; foto, avaliações, cartão salvo; SMS de reserva; cashback e segmentação (SAI-021, SAI-061).

## Perguntas em aberto (não bloqueiam a aprovação)
1. Validade da sessão: 30 dias (proposta) ou outro valor.
2. Teto diário de códigos por loja: 100 (proposta).
3. Texto da política de privacidade do cliente final (hoje só existe a do dono).
4. Quem assume cada metade: Comanda (aorus-4d/4c) e CRM (aorus-03), com módulos separados para não editar os mesmos arquivos.
