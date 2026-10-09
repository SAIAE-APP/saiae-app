# Onboarding de configuração inicial — roteiro E2E (staging)

Para o João e quem testar. Escrito em português simples. **Só no ambiente de teste** (staging, projeto `qzcqwovbbylqxljcrqhk`), com e-mails fictícios `...@staging.saiae.invalid`. Não crie conta de teste pelo link de prévia do PR nem pelo app de produção: eles apontam para o banco de produção.

Spec: `docs/superpowers/specs/2026-10-08-onboarding-configuracao-design.md`. Regras de staging: `docs/staging.md`.

## 0. Preparação (a equipe faz, nesta ordem)
1. Migrations no staging: `npm run staging:push` (precisa incluir `20261020100000_onboarding_config.sql` e `20261020110000_consultas_externas.sql`).
2. Edge function: `npm run staging:deploy` (inclui `consultar-externo`, **com** verificação de login).
3. Conferir o banco: `STAGING_SUPABASE_URL=... STAGING_CHAVE_SERVICO=... STAGING_ANON_KEY=... node tests/onboardingBanco.staging.mjs` (chaves vindas do painel, nunca coladas em chat). Todas as linhas devem sair `OK`.
4. Testes sem rede: `npm test` verde.
5. Subir o app em modo staging **com a flag**: em `.env.staging.local`, `VITE_ONBOARDING_CONFIG=1`; depois `npm run dev:staging` (ou `npm run build:staging`). O script aborta se o env apontar para produção.
6. Anote o horário do início do teste e o e-mail de cada conta criada.

Para as perguntas "como estava antes", tenha também uma **barraca antiga** no staging (a de seed, `dono@staging.saiae.invalid`; a senha é impressa uma única vez pelo `npm run staging:seed`).

## 1. Conta nova pelo caminho completo (e-mail)
Use um e-mail novo, por exemplo `onb-1@staging.saiae.invalid`. Teste no celular (375 px) e depois no computador.

| # | Faça | Esperado | ☐ |
|---|---|---|---|
| 1.1 | Crie a conta e entre. | Cai no assistente (`/configurar`), passo 1, com barra "Passo 1 de 10". Não cai em "Vamos criar sua barraca". | ☐ |
| 1.2 | Passo 1: escolha "Indicação" e escreva uma pessoa fictícia. Continue. | Avança. "Fazer depois" existe. | ☐ |
| 1.3 | Passo 2: escolha uma categoria. | Avança. | ☐ |
| 1.4 | Passo 3: digite "Lanchonete do Zé!" | O link aparece em tempo real como `.../lanchonete-do-ze` (sem acento, sem símbolo), com "copiar". Não existe "fazer depois" aqui. | ☐ |
| 1.5 | Passo 3: troque para um endereço já usado (o da barraca de seed) e para um reservado (`login`, `ajustes`). | Recusa com mensagem clara; para o ocupado, oferece sugestões (`-2`, `-3`). Nenhuma barraca foi criada ainda. | ☐ |
| 1.6 | Passo 3: aceite um link livre e continue. | Cria a barraca e segue. | ☐ |
| 1.7 | Passo 4 (CNPJ): digite um CNPJ **inválido** (14 dígitos errados). | Recusa antes de consultar. | ☐ |
| 1.8 | Passo 4: digite um CNPJ **válido de empresa pública** (por exemplo o de um grande banco). | Preenche o nome da empresa e sugere o endereço. Nada trava. | ☐ |
| 1.9 | Passo 5 (endereço): digite um CEP real. | Preenche rua, bairro, cidade e UF; você completa número e complemento. | ☐ |
| 1.10 | Passo 6 (horário): escolha "Almoço", depois "Igual ao dia anterior" em um dia, depois deixe um dia com fecha antes de abre. | O modelo preenche os 7 dias; "igual ao dia anterior" copia; horário inválido mostra erro e bloqueia o "Continuar". | ☐ |
| 1.11 | Passo 7 (pagamento): desmarque tudo. | "Continuar" fica desabilitado e explica que falta pelo menos uma forma. Só aparecem Dinheiro, Débito e Crédito. Marque duas. | ☐ |
| 1.12 | Passo 8 (modos): desmarque tudo; depois marque **Retirada** (sem Entrega). | Bloqueia sem nenhum; com Retirada, **pula o passo de taxa** e a barra mostra "de 9". | ☐ |
| 1.13 | Tela final. | Mostra o resumo, o link do cardápio (copiar/compartilhar) e os botões "Ir para o Hub" e "Cadastrar meus itens". | ☐ |
| 1.14 | Abra o link do cardápio num navegador sem login. | A loja abre no endereço escolhido. | ☐ |
| 1.15 | Toque "Ir para o Hub". | Hub abre. O assistente não volta a aparecer ao recarregar. | ☐ |

## 2. Entrega e taxa (segunda conta)
Conta nova `onb-2@...`. Faça os passos 1 a 7 rapidamente.

| # | Faça | Esperado | ☐ |
|---|---|---|---|
| 2.1 | Passo 8: marque **Entrega**. | Aparece o passo 9 (taxa) e a barra mostra "de 10". | ☐ |
| 2.2 | Passo 9: "Taxa única" com valor; e, em outra rodada, "Por bairro" colando `Centro; 5,00`. | Grava. "Fazer depois" existe aqui. | ☐ |
| 2.3 | Abra o cardápio público dessa loja. | Entrega aparece quando a loja está finalizável (ver `CLAUDE.md`, "Taxa por bairro e Entrega no cardápio"). | ☐ |

## 3. Retomar de onde parou
Conta nova `onb-3@...`.

| # | Faça | Esperado | ☐ |
|---|---|---|---|
| 3.1 | Vá até o passo 5 (depois do 3, a barraca já existe) e **feche a aba**. | Nada se perde. | ☐ |
| 3.2 | Entre de novo com a mesma conta. | Volta ao assistente, no passo certo (5), e não vai para o Hub nem para "Vamos criar sua barraca". | ☐ |
| 3.3 | Abandone nos passos 6 a 8 e volte. | Enquanto os 4 obrigatórios não estiverem completos, sempre retoma no assistente. | ☐ |

## 4. Opcionais, "fazer depois" e checklist no Hub
Conta nova `onb-4@...`: pule 1, 2, 4, 5 (e 9 se houver) com "Fazer depois"; preencha só 3, 6, 7 e 8.

| # | Faça | Esperado | ☐ |
|---|---|---|---|
| 4.1 | Chegue ao Hub. | Cartão "Falta pouco para vender" com uma **porcentagem** e os itens abertos (endereço, CNPJ, primeiro item, logo, Pix online, e taxa se houver Entrega). | ☐ |
| 4.2 | Cadastre um item no cardápio e volte ao Hub. | A porcentagem sobe sozinha. | ☐ |
| 4.3 | Toque num item aberto. | Leva à tela certa (passo do assistente ou Ajustes). | ☐ |
| 4.4 | Toque "Ocultar por 7 dias". | O cartão some e continua oculto ao recarregar. | ☐ |
| 4.5 | Sem Entrega, confira se "Taxa de entrega" **não** conta na porcentagem. | Não aparece na lista. | ☐ |
| 4.6 | Marque "Sou MEI / ainda não tenho CNPJ" (passo 4) em outra conta. | O item de CNPJ conta como feito. | ☐ |

## 5. Barraca antiga nunca é bloqueada
Entre com `dono@staging.saiae.invalid` (a barraca de seed, anterior à migration).

| # | Faça | Esperado | ☐ |
|---|---|---|---|
| 5.1 | Entre e recarregue várias vezes. | Vai direto ao Hub. **Nunca** é levada ao assistente. | ☐ |
| 5.2 | Olhe o Hub. | No máximo o cartão de pendências, só como aviso. Sem bloqueio de nenhuma função. | ☐ |
| 5.3 | Lance um pedido, abra Ajustes, Cozinha e Histórico. | Tudo funciona como antes. | ☐ |
| 5.4 | Numa conta Pro/trial, crie uma 2ª barraca por "Nova barraca" e depois saia e entre de novo. | A barraca antiga continua intocada. A nova não tem o assistente concluído, então o `Dispatcher` deve levá-la ao assistente (a spec previa abrir direto no passo 3 pelo botão "Nova barraca"; hoje o botão ainda usa o formulário antigo). **Anote o que acontecer**, é a dúvida deste item. | ☐ |

## 6. Flag desligada = fluxo antigo
Gere o app **sem** `VITE_ONBOARDING_CONFIG` (ou com outro valor que não `1`).

| # | Faça | Esperado | ☐ |
|---|---|---|---|
| 6.1 | Conta nova. | Cai em "Vamos criar sua barraca" (nome + link), como sempre. Nada do assistente. | ☐ |
| 6.2 | Hub. | Sem o cartão de pendências. | ☐ |

## 7. Serviços externos fora do ar
| # | Faça | Esperado | ☐ |
|---|---|---|---|
| 7.1 | Passos 4/5 com internet, mas simulando falha (peça à equipe para usar um CNPJ/CEP que não existe). | "Não encontrado" ou "preencha à mão"; o passo **nunca trava**. | ☐ |
| 7.2 | Faça mais de 30 consultas de CNPJ em 1 hora (a equipe pode reduzir o limite no teste). | Mensagem de limite; preencher à mão continua possível. | ☐ |
| 7.3 | Chame a função sem estar logado (a equipe faz por script). | Recusa (401). | ☐ |

## 8. Segurança e privacidade (a equipe confere no banco de staging)
- `perfis_usuario`: usuário A não lê nem grava o de B (já coberto por `tests/onboardingBanco.staging.mjs`).
- `slug_disponivel` devolve só verdadeiro/falso.
- `onboarding_salvar_passo` rejeita campo desconhecido e repetir o mesmo passo não duplica nada.
- `consultas_externas_log` e `onboarding_eventos` **não** contêm CNPJ, CEP, endereço nem texto livre.
- O navegador não chama `brasilapi.com.br` nem `viacep.com.br` (abra a aba Rede do navegador durante os passos 4 e 5: só deve aparecer a chamada ao nosso servidor).
- Nenhum segredo (token de Pix, de nota fiscal) passa pelo assistente.
- Excluir a conta de teste (Ajustes › Excluir conta) apaga a origem/categoria, o endereço e os eventos do onboarding daquela conta.
- A página `/privacidade` descreve o que foi coletado: origem, categoria, endereço, CNPJ, a consulta por terceiros, conversas da IA e leads do panfleto.

## 9. Acessibilidade e visual
- Toque ≥ 44 px em todos os botões e chips; barra de progresso lida pelo leitor de tela ("Passo X de N").
- Modo escuro e claro; celular em pé e computador (coluna central).
- Animação da tela final desligada com "reduzir movimento" ativado no aparelho.
- Texto simples, sem jargão; um botão principal (mostarda) por tela.

## 10. Kits iniciais (cardápio de exemplo)
Só com o app gerado **com as duas flags** (`VITE_ONBOARDING_CONFIG=1` e `VITE_ONBOARDING_KITS=1`) e a migration `20261021110000` aplicada no staging. Antes: `node tests/kitsIniciais.staging.mjs` com tudo `OK` (a equipe roda; rodar de novo quando a migration do valor livre entrar). Conta nova, e-mail `...@staging.saiae.invalid`. O kit **só vale no app novo** (decisão do João); teste no navegador/PWA.

| # | Faça | Esperado | ☐ |
|---|---|---|---|
| 10.1 | Passo 2: escolha "Lanches". | Aparecem os kits **Lanchonete** e **Hamburgueria**, "Ver outros modelos" e "Começar do zero". Nada é criado ainda. | ☐ |
| 10.2 | Toque em "Ver outros modelos". | Aparecem os outros 6 kits. Com "Oriental", "Bebidas" ou "Churrasco" os 8 aparecem direto. | ☐ |
| 10.3 | Escolha **Hamburgueria**, passo 3 com nome e link, Continuar. | A barraca é criada e o kit montado. Aparece a frase "Montamos um cardápio de exemplo…" nos passos seguintes. | ☐ |
| 10.4 | Passo 6 (horário) e passo 8 (modos). | Vêm com **Jantar** e **Mesa, Balcão, Entrega** marcados e a legenda "Sugestão do modelo Hamburgueria". Nada foi gravado: mude um deles e confirme que vale o que você escolheu ao Continuar. | ☐ |
| 10.5 | Passos 6 e 8 de uma conta que já confirmou o passo e voltou. | Vale o que está salvo, sem sugestão. | ☐ |
| 10.6 | Tela final. | O botão virou "Completar os preços do cardápio". | ☐ |
| 10.7 | Abra o cardápio público da loja **antes** de preencher qualquer preço. | **Nenhum item** do kit aparece (todos inativos). | ☐ |
| 10.8 | Em "Completar o cardápio de exemplo", marque o Burger clássico **sem** preço e toque em Salvar. | Erro na linha ("Informe o preço…"); nada é salvo. | ☐ |
| 10.9 | Preencha o preço do Burger clássico e os tamanhos Simples e Duplo (marcados), salve. | "Salvo". O cardápio público mostra **só** o Burger clássico, com Simples/Duplo e Ponto da carne obrigatório. | ☐ |
| 10.10 | Tente marcar um tamanho sem preço. | Erro ("ele substitui o preço do item"). | ☐ |
| 10.11 | Marque um item que tem tamanho obrigatório sem ativar nenhum tamanho. | Aviso de que o item não poderá ser pedido; salvar é permitido. | ☐ |
| 10.12 | Hub. | O checklist mostra "Completar os preços do cardápio de exemplo" até acabarem os itens sem preço; depois o item some. | ☐ |
| 10.13 | Ajustes › Opções. | Os grupos do kit estão lá e podem ser editados; "Opções" já aparece ligada. | ☐ |
| 10.14 | Conta nova: passo 2 com **"Começar do zero"**. | Barraca vazia e **sem** a oferta "Montar um cardápio de exemplo" no Hub. | ☐ |
| 10.15 | Outra conta: **pule** o passo 2. | Barraca vazia; o Hub mostra "Montar um cardápio de exemplo (opcional)". Toque, escolha **Feira**: monta o kit sem grupos e a opção "Opções" **continua desligada**. | ☐ |
| 10.16 | Conta onde você já cadastrou um item e depois tenta a oferta (peça à equipe para forçar). | Mensagem "Seu cardápio já tem itens…"; nada é misturado nem alterado. | ☐ |
| 10.17 | Barraca **antiga** (a de seed). | Nenhum seletor de kit, nenhuma oferta, mesma porcentagem de antes. | ☐ |
| 10.18 | Feche o app logo depois de criar a barraca no passo 3 e abra de novo. | O assistente retoma e o kit aparece montado **uma vez só** (sem duplicar). | ☐ |
| 10.19 | Os 8 kits, uma conta cada (ou a equipe aplica por script): feira, quermesse, lanchonete, açaí, hamburgueria, pizzaria, pastelaria, PF. | Cada um monta sem erro; itens inativos; grupos conforme a spec (ex.: pizzaria sem "Gigante" nem categoria "Borda"; PF com Mistura obrigatória). | ☐ |
| 10.20 | Ajustes › Opções › **Usar modelo** (loja com kit Pizzaria). | Os modelos de pizza vêm primeiro ("Para o seu negócio"); a busca por "borda" acha o modelo; "Sabores do combo" abre com mínimo 3 e máximo 3. | ☐ |
| 10.21 | Com a flag dos kits **desligada**. | O assistente e Ajustes ficam como antes (sem seletor de kit, sem "Usar modelo" novo, sem campo "mínimo"). | ☐ |
| 10.22 | Sem internet na tela de completar preços. | "Sem internet"; nada é perdido ao voltar. | ☐ |

## 11. Depois do teste
1. Apague as contas fictícias criadas (ou rode o re-seed do staging).
2. Anote o que falhou com a hora e o número do item.
3. Produção só com ordem do João e fora do horário de uso: migrations → função → app com a flag **desligada** → ligar a flag e testar com uma conta de teste → só então liberar.
