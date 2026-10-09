# Login com Google — passos de configuração (João)

Spec: `docs/superpowers/specs/2026-10-08-login-google-design.md`. O código da Fase 1 (web/PWA) já está pronto atrás da variável `VITE_LOGIN_GOOGLE`; **sem estes passos o botão fica oculto e nada muda**.

**Regra de ouro:** o *ID do cliente* e o *Segredo do cliente* do Google você **cola só no painel do Supabase**. Nunca no chat, nunca em arquivo do repositório. Faça primeiro no **staging**, teste, e só depois repita na **produção** (clientes OAuth e URLs separados).

| | Staging | Produção |
|---|---|---|
| Projeto Supabase | `qzcqwovbbylqxljcrqhk` | `vimjwzumjggrlvlxdejr` |
| URI de redirecionamento no Google | `https://qzcqwovbbylqxljcrqhk.supabase.co/auth/v1/callback` | `https://vimjwzumjggrlvlxdejr.supabase.co/auth/v1/callback` |
| Site URL no Supabase | URL do app de staging | `https://app.saiae.com.br` |
| Redirect URLs no Supabase | `<URL do staging>/**` e `http://localhost:5199/**` | `https://app.saiae.com.br/**` |
| Variável no Cloudflare Pages | `VITE_LOGIN_GOOGLE=1` (ambiente de staging) | `VITE_LOGIN_GOOGLE=1` (produção, **só depois** do teste e da ordem do dono) |

## Passo a passo
1. **Google Cloud Console** → projeto "Sai aê" (crie se não houver) → *APIs e serviços → Tela de consentimento OAuth*: tipo **Externo**; nome "Sai aê"; e-mail de suporte; logo; domínio autorizado `saiae.com.br`; página inicial e política de privacidade `https://app.saiae.com.br/privacidade`; escopos `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`; **Publicar o app** (status "Em produção").
2. *Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web*; em **URIs de redirecionamento autorizados** coloque a linha da tabela acima (uma por ambiente).
3. **Painel do Supabase** (projeto do ambiente) → *Authentication → Providers → Google*: ligar; colar o **ID do cliente** e o **Segredo do cliente**; salvar.
4. *Authentication → URL Configuration*: preencher **Site URL** e **Redirect URLs** da tabela (sem curinga genérico `https://*`).
5. *Authentication → Sign In / Providers (ou Settings)*: conferir que **Confirm email está ligado**.
6. No Cloudflare Pages, definir `VITE_LOGIN_GOOGLE=1` e republicar o ambiente.

## Prompt pronto para a extensão Claude no Chrome
Cole o texto abaixo na extensão, com a aba já logada na conta Google e no Supabase. Troque `<AMBIENTE>` por `STAGING` ou `PRODUÇÃO`.

```
Quero configurar o login com Google do app Sai aê no ambiente <AMBIENTE>. Siga os passos de
docs/login-google-passos.md (tabela do ambiente certo), uma tela por vez, e me avise antes de salvar.

REGRAS DE SEGURANÇA (obrigatórias):
- NÃO leia, copie, repita nem escreva em lugar nenhum o "Segredo do cliente" nem o "ID do cliente" do Google.
  Eles não podem aparecer no chat, nem em prints que você descreva.
- Pare ANTES de gerar/exibir o segredo no Google e ANTES de colar qualquer valor no Supabase: eu faço essas
  duas ações sozinho. Você só me leva até a tela certa e me diz "agora é com você".
- Não mexa em nenhum outro projeto, provedor ou configuração. Se o projeto não for o do ambiente <AMBIENTE>
  (staging = qzcqwovbbylqxljcrqhk, produção = vimjwzumjggrlvlxdejr), pare e me avise.
- Não clique em nada que apague, desligue provedores ou publique mudanças em produção sem eu confirmar.

O QUE FAZER:
1. Google Cloud Console: conferir/abrir a tela de consentimento OAuth (Externo, nome "Sai aê", domínio saiae.com.br,
   escopos openid/email/profile, publicada) e ir até Credenciais → Criar ID do cliente OAuth (Aplicativo da Web)
   com o URI de redirecionamento da tabela para <AMBIENTE>. Pare antes de exibir o segredo.
2. Supabase do <AMBIENTE>: Authentication → Providers → Google: abrir a tela e parar para eu colar ID e segredo.
3. Authentication → URL Configuration: preencher Site URL e Redirect URLs da tabela.
4. Conferir "Confirm email" ligado e me dizer o que viu.
No fim, me liste o que foi conferido e o que ficou para mim.
```

## Depois de configurar: teste (staging)
Veja o plano de testes na seção 6 da spec. O mais importante: conta nova pelo Google ganha 7 dias de teste; mesma conta por senha + Google entra na **mesma** conta; e-mail com teste já usado **não** ganha outro. Anote o que o Supabase fizer nos 3 casos de vinculação (spec, seção 2).
