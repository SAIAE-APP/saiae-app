# Criar conta e entrar com Google (Gmail) — design

Data: 2026-10-08. Fonte: pedido do orquestrador. Status: **só especificação, aguardando revisão do dono do produto. Nenhum código, nenhuma mudança de Auth e nada em produção.**

## Objetivo
O dono (e operador) da barraca cria a conta e entra no app Sai aê com um toque em **"Continuar com Google"**, sem digitar senha, na web/PWA e no app Android. O login por e-mail e senha continua existindo exatamente como é hoje.

## Estado atual (auditado em origin/main)
- `useAuth` (`src/hooks/useAuth.ts`): `signInWithPassword`, `signUp` e `resetPasswordForEmail` (`redirectTo` via `urlPublica`). Cadastro exige confirmação de e-mail ("Mandamos um link de confirmação").
- `Login.tsx` e `Cadastro.tsx` usam `LayoutAuth`; preservam o parâmetro `?voltar=` (usado por `/assinar`). `Dispatcher.tsx` decide o destino: sem sessão vai a `/onboarding` (1ª vez) ou `/login`; com sessão e 1 barraca abre a barraca; com 0 ou várias vai a `/selecionar-barraca`, que já convida a criar a primeira barraca (`criar_barraca`).
- Trial: trigger `on_auth_user_created_assinatura` em `auth.users` → `criar_assinatura_trial()` (migration `20260922120000`): 7 dias `trialing/pro`; se o `lower(email)` já está em `contas_trial_usadas`, nasce `expired`. Assinatura é por **dono** (`usuario_id`), funcionário só herda o status do dono.
- Exclusão: `excluir-conta` (edge function) chama `excluir_dados_conta` e `auth.admin.deleteUser` a partir do JWT. Não pede senha.
- Android nativo: Capacitor 8, `appId = com.aia.mesaagil`, `webDir = dist` (o app carrega o build local, origem `https://localhost`). Não há `@capacitor/app` nem `@capacitor/browser` nem esquema de URL próprio hoje.
- Biometria (`GateFaceId`, WebAuthn local) e senha administrativa (`GateSenhaAdmin`) são independentes do login e não mudam.

## Decisões propostas (a confirmar com o dono)
| # | Proposta |
|---|---|
| 1 | Só **Google** nesta fase (sem Apple, Facebook, link mágico). |
| 2 | Web/PWA primeiro (Fase 1); Android nativo na Fase 2, em build novo. |
| 3 | Fluxo **PKCE** (`flowType: 'pkce'` no cliente Supabase). |
| 4 | Guardamos **só o e-mail** vindo do Google; nome e foto não são usados nem copiados para tabelas nossas. |
| 5 | Vincular identidades (mesmo e-mail com senha e Google) **só quando o e-mail do Google é verificado** e a conta por senha já foi confirmada. |
| 6 | Botão controlado por `VITE_LOGIN_GOOGLE=1` (desligado por padrão), para publicar o código antes da configuração do Google e ligar por ambiente. |

## 1. Web/PWA
**Código (pequeno):**
- `useAuth.entrarComGoogle(voltar?)` → `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: urlPublica('/'), queryParams: { prompt: 'select_account' } } })`. `redirectTo` aponta para a raiz: o `Dispatcher` já resolve o destino com a sessão criada. O parâmetro `voltar` de `/assinar` viaja como query do `redirectTo` e `Dispatcher`/`Login` o respeitam (hoje só o `Login` por senha o faz; ajustar o `Dispatcher` para ler `voltar` quando houver sessão recém-criada).
- Cliente Supabase com `flowType: 'pkce'`. Rotas existentes (`/esqueci-senha`, `/redefinir-senha`) continuam funcionando com PKCE; testar.
- `Login.tsx` e `Cadastro.tsx`: botão **"Continuar com Google"** acima do formulário, com divisor "ou" (o divisor já existe no Login). IDV Sai aê: botão `outline` (um primário mostarda por tela continua sendo "Entrar"/"Criar conta"), altura ≥ 44 px (`size="xl"`), ícone do "G" oficial em SVG próprio (cores da marca Google, exigência das diretrizes de marca), texto em tinta, canto de botão (`--radius-mesa-btn`), estado `loading` e erro em linguagem simples ("Não foi possível entrar com o Google. Tente de novo."). Cancelar na tela do Google volta ao Login sem erro técnico.
- Login e Cadastro usam o mesmo botão: com Google "entrar" e "criar conta" são a mesma ação (o Supabase cria o usuário no primeiro acesso).
- Copy: "Continuar com Google" nas duas telas; abaixo, em texto pequeno no Cadastro, o aceite dos termos já usado hoje.

**Redirect URLs (painel Supabase › Authentication › URL Configuration):**
- Site URL: `https://app.saiae.com.br` (produção) e a URL do app de staging (staging).
- Redirect URLs permitidas: `https://app.saiae.com.br/**`; no staging, o domínio do Pages de staging e `http://localhost:5199/**` (dev). **Sem curinga genérico** (`https://*`).
- Google Cloud › URI de redirecionamento autorizado: **`https://<ref>.supabase.co/auth/v1/callback`** (um por projeto: produção `vimjwzumjggrlvlxdejr`, staging `qzcqwovbbylqxljcrqhk`).

## 2. O que precisa continuar valendo
**Trial de 7 dias:** o trigger roda em `INSERT` em `auth.users`, e o usuário do Google também é inserido ali, com `email` preenchido (o Supabase copia o e-mail verificado do Google). Nada muda no trigger. Pontos de verificação:
- Conta nova pelo Google ganha `trialing/pro` por 7 dias; `contas_trial_usadas` recebe o e-mail em minúsculas.
- **1 trial por e-mail para sempre:** quem já teve trial (por senha) e depois entra com Google com o **mesmo e-mail**: se as identidades forem vinculadas, **não nasce usuário novo** (continua a mesma assinatura); se não vincular e nascer outro usuário, o trigger o marca `expired`. Nos dois casos não há 2º trial.
- Limite conhecido, fora de escopo: variações do mesmo Gmail (`+alias`, pontos) contam como e-mails diferentes, hoje e depois. O Google devolve o e-mail "canônico" que a pessoa usa, o que não piora o cenário atual.
- **Assinatura por dono** e funcionário herdando o status: inalterados (a chave é `usuario_id`).
- Webhooks de pagamento (Kirvano/Stripe) casam a compra com o usuário por **e-mail**: continuam funcionando, pois o e-mail do Google é o mesmo da compra se a pessoa usar o mesmo Gmail; se comprar com outro e-mail, vale a regra de hoje (compra por e-mail sem conta nasce `active` quando a conta é criada).
- **Sem barraca:** quem entra pelo Google e não tem barraca cai no `Dispatcher` com 0 barracas → `/selecionar-barraca`, que já mostra "criar sua primeira barraca" (`criar_barraca`, limite de plano preservado). O carrossel de onboarding continua sendo exibido só no 1º acesso do aparelho.
- **Mesmo e-mail com senha já existente (risco de takeover):**
  - Regra: só vincular Google a uma conta existente quando o Google informa `email_verified = true` **e** a conta por senha tem e-mail confirmado. O app já exige confirmar o e-mail no cadastro; **manter "Confirm email" ligado** em produção e staging (verificar, pois é a defesa contra o ataque de "pré-cadastro": o invasor cria `vitima@gmail.com` com senha antes da vítima entrar com Google).
  - O Supabase vincula automaticamente identidades de mesmo e-mail verificado. **A confirmar no teste de staging** (item 6): (a) conta por senha confirmada + Google → entra na mesma conta, sem novo usuário nem novo trial; (b) conta por senha **não** confirmada + Google → a senha antiga não pode continuar valendo para quem não é o dono do e-mail (o Supabase invalida a senha de cadastro não confirmado ao vincular; conferir); (c) e-mail do Google sem verificação (contas Workspace com domínio próprio sem verificação) → não vincula, erro claro.
  - Se o comportamento do Supabase não bater com (a)–(c), a alternativa é **desligar a vinculação automática** (`GOTRUE_SECURITY_MANUAL_LINKING`/configuração equivalente do painel) e mostrar "Esse e-mail já tem conta com senha. Entre com a senha e depois vincule o Google em Ajustes".
- **Conta só-Google não tem senha:** "Trocar senha da conta" (`ModalTrocarSenha`, `updateUser`) deve virar "Criar uma senha" para quem não tem senha; "Esqueci a senha" já funciona para criar uma pela primeira vez (e-mail verificado). Textos que dizem "entrar com e-mail e senha de novo" (Ajustes, biometria) passam a dizer "entrar de novo". Biometria e `GateSenhaAdmin` não mudam.
- **Excluir conta:** `excluir-conta` não pede senha e usa o JWT, então funciona igual para conta Google; `deleteUser` remove também as identidades. Atualizar o texto da página pública `/excluir-conta` ("sua conta de acesso: e-mail e senha" → "e-mail e login com Google, se usado").

## 3. App Android nativo (Capacitor)
**Problema:** o Google bloqueia OAuth dentro de WebView (`disallowed_useragent`), e o app roda o web local em `https://localhost`. Duas saídas:

| | A) Plugin nativo de login (Credential Manager) + `signInWithIdToken` | B) Navegador do sistema (Custom Tab) + deep link |
|---|---|---|
| Como | Plugin (`@capgo/capacitor-social-login` ou similar compatível com Capacitor 8) devolve um **ID token** do Google; o app chama `supabase.auth.signInWithIdToken({ provider: 'google', token, nonce })`. | `@capacitor/browser` abre a URL do `signInWithOAuth` (`skipBrowserRedirect: true`); o Google volta para `com.aia.mesaagil://auth/callback`; `@capacitor/app` (`appUrlOpen`) captura e chama `exchangeCodeForSession`. |
| Google Cloud | **3 clientes**: Web (usado como `serverClientId`/audiência), **Android** (pacote `com.aia.mesaagil` + SHA-1 da chave de **assinatura da Play** e da chave de upload) e o Web já existente. Precisa listar os IDs em Supabase › Auth › Google › "Authorized Client IDs". | **1 cliente** (o Web, o mesmo da Fase 1). |
| Build novo | Sim: plugin nativo, `versionCode` > atual, `npx cap sync`, recompilar e enviar à Play. | Sim: dois plugins oficiais, `intent-filter` com o esquema no `AndroidManifest.xml`, `versionCode` maior. |
| UX | Melhor: seletor de contas nativo, sem sair do app. | Boa: abre uma aba do Chrome e volta ao app. |
| Risco | SHA-1 errado (chave da Play ≠ chave local) = erro 10/12500 só em produção; plugin de terceiros pode atrasar atualização do Capacitor; nonce. | Retorno do deep link depende do navegador padrão; o verificador PKCE precisa sobreviver no `localStorage` da WebView (sobrevive). |

**Recomendação:** **B** na Fase 2. Usa a mesma configuração do Google da web (um cliente só), plugins oficiais do Capacitor, sem SHA-1 nem plugin de terceiros. Se a equipe quiser o seletor nativo depois, migra para **A** sem mudar o servidor. Em ambos, nada funciona sem **build novo** (versionCode > o do `.aab` de produção); o APK atual não ganha Google e continua com e-mail e senha (o botão simplesmente não existe nele, pois o web é embutido no build).
- Detalhes de B: esquema `com.aia.mesaagil`, redirect `com.aia.mesaagil://auth/callback` na lista de URLs do Supabase; detectar plataforma (`Capacitor.isNativePlatform()`) para escolher entre `redirectTo` web e deep link; tratar o usuário que fecha a aba (volta ao Login sem erro).

## 4. LGPD e Política de Privacidade
- **Dados que recebemos do Google:** e-mail (usado como identificador da conta, igual ao cadastro por senha), identificador da conta Google (`sub`) e, pelo escopo padrão do Supabase (`openid email profile`), nome e URL da foto. Ficam **apenas no Supabase Auth** (`auth.users`/`identities`); **não usamos nem copiamos** nome/foto para nossas tabelas. Se for viável no painel, restringir o escopo a `openid email`; senão, documentar.
- **Política (`Privacidade.tsx`, seção 2 "Conta"):** acrescentar "ou login com Google (e-mail e identificador da conta Google; nome e foto que o Google informa ficam guardados no provedor de autenticação, mas não são usados)". Incluir a frase de uso limitado exigida pelas regras de dados de usuário das APIs do Google: o app usa os dados do Google só para identificar a conta e **não** os repassa nem usa para publicidade.
- **Tela de consentimento OAuth:** escopos básicos (não sensíveis) dispensam verificação do Google, mas exigem link da política de privacidade (`https://app.saiae.com.br/privacidade`), página inicial do app e domínio autorizado (`saiae.com.br`).
- **Excluir conta:** ver seção 2. Opcional (v2): "revogar acesso" na conta Google é feito pelo próprio usuário; a página `/excluir-conta` pode orientar.
- Clientes finais do cardápio **não** usam Google (perfil por WhatsApp é outra frente).

## 5. Passos manuais do João (nunca colar segredos no chat)
Fazer **duas vezes**, uma para **staging** e outra para **produção** (clientes OAuth e URLs separados; nunca reaproveitar):
1. **Google Cloud Console** › criar/usar um projeto "Sai aê" › *APIs e serviços › Tela de consentimento OAuth*: tipo **Externo**, nome do app "Sai aê", e-mail de suporte, logo, domínio autorizado `saiae.com.br`, links de política (`/privacidade`) e página inicial; escopos: `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`. Publicar (status "Em produção") para qualquer pessoa conseguir entrar.
2. *Credenciais › Criar credenciais › ID do cliente OAuth › Aplicativo da Web*: URI de redirecionamento autorizado = `https://<ref>.supabase.co/auth/v1/callback` (staging: `qzcqwovbbylqxljcrqhk`; produção: `vimjwzumjggrlvlxdejr`).
3. **Painel Supabase** do projeto correspondente › *Authentication › Providers › Google*: ligar, colar **ID do cliente** e **Segredo do cliente** diretamente no painel (nunca no chat); *Authentication › URL Configuration*: Site URL e Redirect URLs da seção 1; conferir **Confirm email** ligado.
4. **Fase 2 (Android, só se escolher A):** ID do cliente **Android** (pacote `com.aia.mesaagil` + SHA-1 do Play App Signing e da chave de upload) e colar o ID web em "Authorized Client IDs".
5. Variável de ambiente `VITE_LOGIN_GOOGLE=1` no Cloudflare Pages (staging primeiro).
Posso gerar um prompt pronto para a extensão Claude no Chrome fazer os passos de tela, com a regra "não leia nem escreva o segredo; pare antes de colar/gerar".

## 6. Plano de testes
**Staging (nunca produção primeiro):**
1. Conta nova pelo Google: usuário criado, `assinaturas` = `trialing/pro` com 7 dias, e-mail em `contas_trial_usadas`; cai em `/selecionar-barraca`, cria a barraca e opera normalmente.
2. Sair e entrar de novo: mesma conta, mesmo trial (sem 2º registro).
3. E-mail com trial já usado (conta antiga, expirada) entrando por Google: **sem novo trial** (usuário vinculado ou `expired`).
4. Vinculação: (a) conta por senha confirmada + Google; (b) conta por senha **não confirmada** + Google (senha antiga deve deixar de valer); (c) e-mail Google não verificado; registrar o comportamento observado.
5. `?voltar=/assinar...`: depois do Google volta ao fluxo de assinatura com plano/ciclo.
6. Cancelar na tela do Google, fechar a aba, bloqueio de pop-up: sem erro técnico, volta ao Login.
7. Conta só-Google: "Criar uma senha" em Ajustes, "Esqueci a senha", biometria e senha administrativa funcionando; exclusão de conta apaga tudo (incluindo identidades).
8. PWA instalado (iOS/Android) e navegador comum; modo escuro; 375 px; alvo de toque ≥ 44 px; conferir que o login por senha segue idêntico com a flag desligada.
9. Regressão: `npm test`, `tsc -b`, `lint`, `vite build`; teste unitário do roteamento do `voltar` e do botão atrás da flag.
**Android (Fase 2):** abrir pelo build de teste fechado, fluxo completo, voltar do navegador ao app, app em segundo plano durante o login, aparelho sem Chrome padrão, Android 7–11 e 12+.
**Produção:** só com ordem do dono, na loja de teste, com a flag ligada primeiro para o próprio João; Supabase de produção com as URLs/clientes da produção.

## Fora de escopo
Apple/Facebook/outros provedores, link mágico, SMS, login do cliente final por Google, SSO entre Comanda e CRM (SAI-006), migração de contas existentes, antifraude de trial por variação de Gmail.

## Perguntas em aberto
1. Fase 2: aceitar a recomendação B (navegador do sistema) ou o dono prefere o seletor nativo (A)?
2. Mostrar o botão Google também no Android atual enquanto não houver build novo? (Não: o web é embutido; só aparece no build novo.)
3. Aceitar a regra de vinculação por e-mail verificado ou desligar a vinculação automática por segurança máxima?
