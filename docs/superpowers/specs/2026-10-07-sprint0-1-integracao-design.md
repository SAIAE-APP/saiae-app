# Sprint 0/1 — Integração Comanda ⇄ CRM (design)

Data: 2026-10-07. Fonte: `PLANO-AGIL-SAIAE.md` v1.1. Status: **aguardando revisão do dono do produto.**

## Objetivo
Fundar a integração Comanda ⇄ CRM (contrato, eventos, SSO, staging, CI) e fechar as lacunas reais do pedido direto com Pix, para depois ligar a IA no WhatsApp oficial (Sprint 2).

## Estado real da Comanda (auditado no `origin/main`, 2026-10-07)
- **Já existe:** Entrega com taxa por bairro, Pix com Entrega, "Pagar na entrega", link do entregador, estoque por item, importar/exportar clientes, "Avisar cliente" por `wa.me`, camada de provedores de Pix.
- **Falta:** adicionais/variações, cupons, eventos de saída, papéis além de `dono`, estorno do Pix, horário validado no servidor.
- **Riscos:** Pix pago depois de expirar não gera pedido; `criar-pagamento-pix` sem rate limit nem honeypot; webhook do Mercado Pago sem validação de assinatura; sem CI; sem staging (produção é o único banco); migrations não criam o schema base (`barracas`, `pedidos`, `itens_do_pedido`, `usuarios_barracas`).

## Decisões do dono do produto (2026-10-07)
- Staging: orquestrador cria. Projeto Supabase `qzcqwovbbylqxljcrqhk` ("Sai ae staging", sa-east-1) criado.
- Meta: dono criando a conta; número do piloto definido por ele (não registrado neste repositório).
- Papéis: **só o dono** agora; operador/admin e convites ficam para depois.
- SSO: edge function `sso-crm` (abaixo).
- Acesso ao CRM: conta `SAIAE-APP` convidada como colaboradora de `saiae-crm`.

## Plano
| # | Tarefa | Frente |
|---|---|---|
| 1 | SAI-004: staging com schema da produção (sem dados), CI (lint, `tsc`, `npm test`), corrigir os erros de lint; CRM: CI e base de testes | ambas |
| 2 | SAI-001: este contrato (`INTEGRACAO.md`) aprovado | orquestrador |
| 3 | Outbox de eventos (`eventos_saida`, triggers, worker com HMAC e retry) | Comanda |
| 4 | CRM: remover `POST /api/messages/{sessionId}/{jid}/spam`; interface `WhatsAppProvider` com Baileys por trás | CRM |
| 5 | SAI-005: conta Meta, número, Meta direta ou BSP, templates | dono |
| 6 | ADR do SSO | orquestrador |
| 7 | Pix: pagamento tardio vira pedido ou refund, rate limit e honeypot, `validarNotificacao`, expiração configurável, cron de expiração | Comanda |
| 8 | Horário validado no servidor; espera média (SAI-033) unificada com `calcularRitmoDoDia` | Comanda |
| 9 | SAI-010a: schema de adicionais/variações, cadastro, cardápio público, `criar_pedido` nova versão, Pix e webhook | Comanda |
| 10 | SAI-010b: Cozinha, impressão, relatórios e NFC-e com adicionais | Comanda |
| 11 | SAI-013: avisos pela Cloud API (botão manual vira fallback) | ambas |

Ordem: 1 primeiro. Depois 2; 3, 4 e 7/8 em paralelo; 9 e 10 em sequência; 11 só com 3, 4 e 5 prontos.
Sessões: aorus-19 (1, 7, 8), aorus-4c (9, 10), aorus-03 = CRM (1 CRM, 4). Item 3 e SSO vão para quem terminar primeiro, nunca em paralelo no mesmo arquivo.

## SSO (decisão)
Edge function `sso-crm` na Comanda: valida o JWT do usuário (`auth.getUser`), confere `usuarios_barracas`, e devolve um JWT curto (RS256, `iss`, `aud` do CRM, `exp` ≤ 60 s, `jti`) com `barraca_id` e `papel='dono'`. O CRM recebe em `/api/sso` (jose, JWKS), cria ou vincula o `User` por e-mail e inicia a sessão NextAuth. Redirect só para destinos em whitelist; `jti` de uso único. Exige no CRM um campo de id externo da barraca/usuário.
Pendências a decidir na SAI-006: usuários que já existem no CRM; servir sob `app.saiae.com.br/whatsapp` (basePath/assetPrefix e cookies) e fonte única de plano (a Comanda empurra o plano pelo contrato; hoje o CRM cobra por dono via Stripe).

## Riscos e restrições
- Staging só com dados fictícios; produção nunca para teste.
- Migrations reversíveis, aplicadas no staging antes da produção; `criar_pedido` com fila offline e fallback `PGRST202` exige migration antes do deploy.
- Pagamento e fiscal só em sandbox/homologação até liberação do dono.
- Cada frente só altera o próprio repositório; mudança de contrato só por PR aprovado pelas duas.
- Verificação da Meta é o caminho crítico do item 11; se atrasar, a Sprint 2 troca com a 3.
