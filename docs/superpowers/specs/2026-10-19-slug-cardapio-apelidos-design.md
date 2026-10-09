# Endereço do cardápio (slug) editável, com apelidos — spec (H7, só diagnóstico + proposta)

Origem: feedback do restaurante D'Helena (cardápio em `/restaurante-paulo/cardapio`; o João diz que o endereço deve ser o nome cadastrado da barraca). **Nada foi alterado em dados de produção.** Esta spec não implementa nada.

## 1. Como é hoje (diagnóstico)
- **Geração:** só na criação da barraca. `SelecionarBarraca.tsx` sugere `gerarSlug(nome)` (sem acento, minúsculo, `[^a-z0-9]+` → `-`) enquanto o dono não edita o campo "Endereço"; se ele editar à mão (`slugEditadoAMao`), vale o que digitou. Foi assim que `restaurante-paulo` pode ter ficado diferente do nome.
- **Guarda:** `barracas.slug` (texto). A RPC `criar_barraca(p_nome, p_slug)` valida `^[a-z0-9]+(-[a-z0-9]+)*$` e "já em uso" por `exists`. Não encontrei (nas migrations do repositório) índice único em `barracas.slug`; a unicidade é só pela checagem da RPC. **A confirmar no banco.**
- **Edição:** **não existe** tela nem RPC para trocar o slug depois de criado. Trocar hoje = `update` direto no banco (ação de suporte).
- **Palavras reservadas:** `criar_barraca` não barra `login`, `cadastro`, `planos` etc. As rotas estáticas ganham de `/:slug` no React Router (`/login`, `/cadastro`, `/assinar`, `/privacidade`, `/excluir-conta`, `/onboarding`, `/esqueci-senha`, `/redefinir-senha`, `/e/:token`), então uma barraca com esse slug ficaria inacessível. Risco existente, a fechar junto.

## 2. Onde o slug aparece (o que quebra ao trocar)
| Lugar | Como usa | Se o slug mudar sem apelido |
|---|---|---|
| Rotas do app e do cardápio (`/:slug`, `/:slug/cardapio`, `/:slug/perfil`, `/:slug/lancar`…) | URL | Link/QR/favorito antigo vira "Não encontrado" |
| **QR codes e links já impressos/divulgados** (cardápio na mesa, bio do Instagram, cartaz) | URL | **Quebram para sempre** — o maior risco |
| Link da IA no WhatsApp | usa `ia_codigo`, **não** o slug | Não muda |
| `ia_contexto.loja.link_cardapio` | `https://app.saiae.com.br/<slug>/cardapio` montado na hora | Passa a mostrar o slug novo (certo) |
| PWA instalado (manifest dinâmico `functions/[slug]/manifest.webmanifest.ts`) | `start_url` e `scope` = `/slug` | O atalho instalado aponta para o slug velho; abre via apelido e redireciona para fora do escopo (barra do navegador aparece). Reinstalar resolve |
| App Android (Capacitor) | mesmas rotas | Mesmo efeito; o dono reabre pela lista de barracas |
| Cache local (`localStorage`): `mesaagil:barraca:<slug>`, cache da assinatura, **sessão do cliente final** (`clienteSessaoLocal`, por slug) | chave por slug | Cache da barraca/assinatura se refaz sozinho. **Cliente final logado no slug velho perde a sessão no novo** (precisa confirmar o telefone de novo) |
| Edge functions públicas que recebem `barraca_slug` (`cliente-sessao`, `cliente-pedir-codigo`, `cliente-verificar-codigo`, `cupom-validar`) e RPCs públicas (`cardapio_publico`, `banners_publicos`, `horarios_publicos`, `bairros_entrega_publicos`, `opcoes_publicas`, `perfil_cliente_config`, `cupom_config`, `assinatura_da_barraca`) | `where slug = …` | Aba aberta com o slug velho para de achar a loja até recarregar |
| Pedidos, cupons, clientes, relatórios, NFC-e, eventos para o CRM | por `barraca_id` | **Não mudam** (nada depende do slug) |

## 3. Proposta
### 3.1 Tabela de apelidos
```
barracas_slugs_antigos (
  slug text primary key,               -- o endereço antigo, já em minúsculo e válido
  barraca_id uuid not null references barracas(id) on delete cascade,
  criado_em timestamptz not null default now()
)
```
RLS ligado, sem policy de leitura direta; acesso só por funções. Slug antigo **nunca** é reaproveitado por outra barraca (a checagem de "em uso" considera `barracas.slug` **e** esta tabela). Aditiva.

### 3.2 Trocar o endereço (RPC)
`barraca_trocar_slug(p_barraca_id uuid, p_novo text) returns jsonb` — `SECURITY DEFINER`, só `authenticated`, **só o dono** da barraca:
1. valida formato (`^[a-z0-9]+(-[a-z0-9]+)*$`, 3 a 40 caracteres) e **lista de reservados** (`login`, `cadastro`, `assinar`, `onboarding`, `privacidade`, `excluir-conta`, `esqueci-senha`, `redefinir-senha`, `e`, `api`, `selecionar-barraca`, `admin`…);
2. recusa se `p_novo` já é slug ou apelido de **outra** barraca (apelido da própria barraca é permitido: voltar atrás);
3. no mesmo statement: grava o slug atual em `barracas_slugs_antigos` e atualiza `barracas.slug`;
4. limite: **1 troca por 24 h** por barraca e **no máximo 10 apelidos** por barraca (evita lixo e abuso);
5. devolve `{ estado: 'ok', slug }` ou `{ estado: 'em_uso' | 'invalido' | 'reservado' | 'muito_cedo' | 'sem_acesso' }`.
`criar_barraca` passa a usar a mesma validação (reservados e apelidos).

### 3.3 Resolver o apelido
- Função pública `barraca_slug_atual(p_slug text) returns text` (anon): devolve o slug **atual** se `p_slug` é atual ou apelido; senão `null`. Só devolve o slug (nada da loja).
- **Front:** `useBarraca`/`CardapioPublico`/`PerfilCliente`: se a barraca não é achada pelo slug da URL, chama `barraca_slug_atual`; se vier outro slug, `navigate(mesmoCaminhoComSlugNovo, { replace: true })`. Cobre QR/link/PWA antigos sem ninguém perceber.
- **Cloudflare (manifest dinâmico):** resolver o apelido antes de montar o manifest (mesma função por REST), para o atalho instalado já nascer com o slug certo.
- **Edge functions com `barraca_slug`:** helper `_shared/resolverSlug.ts` (slug → `barraca_id` considerando apelidos). Sem pressa: só afeta abas abertas durante a troca.
- Sessão do cliente final: ao redirecionar do apelido para o slug novo, o front **copia** a chave `saiae:cliente:<antigo>` para a do novo (uma vez), preservando o login.

### 3.4 Tela
Ajustes › Cardápio & Operação › Cardápio digital: campo "Endereço do cardápio" (hoje só mostra o link), botão **Salvar** (padrão do app), pré-visualização `app.saiae.com.br/<novo>/cardapio`, aviso claro antes de salvar ("QR codes e links antigos continuam funcionando; o atalho instalado no celular pode precisar ser reinstalado"), botão "Usar o nome da barraca" (preenche `gerarSlug(nome)`). Só o dono vê o campo editável.

## 4. Decisões para o João
1. Só o **dono** troca (recomendado) ou também o gerente?
2. **Apelidos para sempre** (recomendado: QR impresso não pode quebrar) ou com validade?
3. Limite de 1 troca por dia e 10 apelidos: ok?
4. Para a loja do Paulo, **antes** da tela existir: troca única por SQL, feita por quem tem acesso ao banco, **com ordem do João**, já gravando `restaurante-paulo` como apelido (o link atual continua valendo). Não faço isso sem ordem; vale esperar a tabela de apelidos para não quebrar o QR que ele já usa.
5. O slug novo deve ser exatamente `gerarSlug(nome)` (ex.: "D'Helena cozinha afetiva" → `d-helena-cozinha-afetiva`)? O campo permite ajustar.

## 5. Plano (PRs pequenos, depois da aprovação)
1. Migration aditiva: tabela de apelidos, `barraca_trocar_slug`, `barraca_slug_atual`, lista de reservados em `criar_barraca` + testes no PGlite.
2. Front: redirecionamento de apelido (`useBarraca`, cardápio, perfil), cópia da sessão do cliente + testes.
3. Ajustes: campo editável + aviso.
4. Cloudflare (manifest) e `_shared/resolverSlug.ts` nas funções públicas.
Tudo em ambiente de teste; produção só com ordem do João e do orquestrador.

## 6. O que NÃO foi verificado
- Se existe índice único em `barracas.slug` no banco real (as migrations do repositório não o criam).
- Como o PWA instalado e o app Android se comportam ao abrir um endereço antigo (depende de aparelho).
- Quantos QR codes impressos existem em produção.
