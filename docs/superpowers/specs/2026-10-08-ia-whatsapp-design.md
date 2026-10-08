# IA no WhatsApp (atendente de dúvidas, fase 1) — design

Data: 2026-10-08. Fonte: respostas do dono do produto em 2026-10-08 (prioridade "IA no WhatsApp, clientes e cupons"; terceira entrega depois do perfil e dos cupons). Status: **aguardando revisão do dono do produto.** Nenhum código foi escrito. Esta especificação cobre a **fase 1**; a fase 2 (a IA fecha pedido e manda o Pix) só começa depois de a fase 1 estar confiável em uso real.

## Objetivo
O cliente final conversa no WhatsApp com uma atendente de IA que responde dúvidas da loja (cardápio, preços, horário, endereço, entrega, pagamento), reconhece o cliente pelo telefone e o leva ao cardápio digital para pedir. Quando não sabe ou o assunto é sensível, chama o dono. A IA **só lê** dados nesta fase; nunca cria nem altera pedido, preço ou desconto.

## Decisões do dono (2026-10-08)
| # | Decisão |
|---|---|
| 1 | Entrega em fases: **fase 1 dúvidas + link do cardápio** (usando o perfil para reconhecer o cliente); **fase 2 fechar pedido** pela conversa, depois. |
| 2 | **Número único do Sai aê** para todas as lojas. O cliente chega por link/QR da loja, que abre a conversa com o código da loja. Número próprio por loja fica como opção futura (a arquitetura não deve impedir). |
| 3 | Escalonamento: a IA **passa para o dono em reclamação ou assunto sensível**; nas dúvidas simples só orienta. |
| 4 | O aviso ao dono vai pelo **WhatsApp do próprio dono**, com resumo e link para falar com o cliente. A tela de conversas dentro do Sai aê fica para depois. |
| 5 | Conhecimento da IA: **cadastro da loja + campo livre do dono**, e a IA **nunca inventa**: sem a informação, diz que vai confirmar e passa para o dono. |
| 6 | Plano: **incluída com limite mensal de conversas por plano**. Passando do limite, a IA volta ao modo "só manda o link do cardápio". Os números do limite saem da medição de custo real na loja de teste. |
| 7 | Arquitetura **A**: a IA roda no **CRM** (dono do número, do webhook e dos modelos da Meta); a Comanda fornece dados por uma rota segura. |

## Estado atual (a confirmar na auditoria do plano)
- CRM (Railway) tem o número de WhatsApp da conta Meta do dono do produto, envia modelos (`codigo_verificacao`, `pedido_recebido`, `pedido_pronto`) e já recebe eventos assinados da Comanda (contrato SAI-001 v1).
- **O webhook de mensagens recebidas do número está pausado** desde a configuração inicial (URL pública pendente na Meta). A fase 1 exige reativá-lo; é ação do dono do produto na Meta, guiada pelo orquestrador.
- Comanda já expõe, por funções públicas, `cardapio_publico`, horários e bairros de entrega; perfil do cliente final (telefone confirmado por código) está em produção na loja de teste.
- Janela de 24 horas: fora dela o WhatsApp só aceita modelos aprovados. A resposta da IA a quem iniciou a conversa é texto livre dentro da janela.

## Parte 1 — Arquitetura e contrato
```
Cliente --WhatsApp--> Meta --webhook--> CRM (conversa + IA) --HMAC--> Comanda (ia-contexto)
                                         |--> Anthropic API (modelo de linguagem)
                                         |--> Meta (resposta livre na janela / modelo para avisar o dono)
```
**Contrato SAI-002 (CRM → Comanda), aditivo ao SAI-001, mesma família de assinatura:**
- `POST {SUPABASE}/functions/v1/ia-contexto`, sem JWT; autenticação por HMAC `sha256=` de `timestamp.rawbody` (cabeçalhos `X-Saiae-Timestamp`, `X-Saiae-Signature`, janela de 5 min), segredo de **plataforma** `IA_CONTEXTO_SEGREDO` (Comanda) = `COMANDA_IA_SEGREDO` (Railway). Mesmo padrão e mesmas regras de higiene do segredo do código de verificação (nunca em chat, gerado e colado pelo dono).
- Corpo: `{ codigo_loja: string, telefone: string }` (telefone só dígitos; a Comanda normaliza como no perfil).
- Resposta (somente leitura, sem dado de outro cliente ou outra loja):
  - `loja`: nome, endereço, horário de funcionamento (e se está aberta agora, no fuso da loja), modos de atendimento ligados, formas de pagamento, taxa de entrega e bairros atendidos, link do cardápio digital.
  - `cardapio`: itens ativos com nome, descrição, preço, categoria, esgotado, grupos de adicionais com preços. Limite de tamanho com truncamento explícito ("lista parcial").
  - `cliente`: **apenas se** existir perfil com `telefone_confirmado_em` preenchido naquela loja: primeiro nome e os itens dos últimos 3 pedidos. Caso contrário `null` (a IA trata como cliente novo e não afirma que o conhece).
  - `ia`: `{ ativa, texto_livre, whatsapp_dono, plano_limite_conversas }`.
- Erros: loja inexistente ou IA desligada devolvem a mesma resposta (`{ ativa: false }`), sem revelar se o código existe.

## Parte 2 — Dados na Comanda (migrations aditivas)
- `barracas`: `ia_habilitada boolean not null default false`, `ia_texto_livre text` (máx. 2000 caracteres), `ia_whatsapp_dono text` (só dígitos, validado), `ia_codigo text unique` (6 caracteres aleatórios sem ambiguidade, gerado ao ligar; é o código do link).
- Função `ia_contexto(p_codigo, p_telefone)` somente para o papel de serviço, montando a resposta acima; a edge function `ia-contexto` valida a assinatura e chama essa função.
- Tela do dono (Ajustes > Cardápio & Operação > **"Atendente IA"**): liga/desliga, campo "O que a IA deve saber" (com exemplos), WhatsApp do dono para avisos (validado, com botão "Enviar teste"), **link e QR code da loja** (`wa.me/<número do Sai aê>?text=<mensagem pronta com o código>`) e o consumo do mês contra o limite (lido do CRM).
- Sem tabelas de conversa na Comanda: as conversas pertencem ao CRM.

## Parte 3 — CRM: conversa e IA
- **Webhook de entrada da Meta** (assinatura `X-Hub-Signature-256` verificada; **idempotente** por id da mensagem, porque a Meta reenvia; mensagens fora de ordem tratadas por timestamp). Ignora tipos não suportados na fase 1 (áudio, imagem, localização) com uma resposta curta pedindo texto.
- **Conversa** por `(telefone, loja)`: estado `ia` ou `humano` (pausada quando o dono foi chamado; volta sozinha em 12 horas ou quando o dono mandar a palavra de liberação definida no aviso). A loja da conversa vem do código na primeira mensagem do link; uma conversa sem código válido recebe uma resposta pedindo para usar o link/QR da loja (sem listar lojas).
- **IA:** modelo de linguagem da Anthropic via API, com prompt de sistema fixo (papel, tom, regras de segurança), contexto da loja e do cliente vindos de `ia-contexto`, histórico curto da conversa (últimas mensagens) e três ferramentas:
  1. `enviar_link_cardapio()` — devolve o link da loja (e o do perfil, se fizer sentido);
  2. `chamar_dono(motivo, resumo)` — pausa a IA na conversa e dispara o aviso ao dono;
  3. `registrar_pergunta_sem_resposta(pergunta)` — guarda para o dono enriquecer o campo livre (relatório simples no painel na fase seguinte).
- **Aviso ao dono:** modelo de utilidade da Meta (a criar e submeter cedo, como o `pedido_saiu_entrega_v2`) com loja, nome do cliente, motivo e o link `wa.me` do cliente; fora da janela de 24 horas do dono, só o modelo vale.
- **Limite do plano:** o CRM conta **conversas** (uma por telefone e loja a cada janela de 24 horas) por mês e por loja. Ao atingir o limite, responde no modo "só link do cardápio" e avisa o dono uma vez. O valor do limite por plano vem do `ia-contexto`; os números são definidos depois da medição de custo.
- **Registro:** guarda mensagens por no máximo **30 dias**; logs de aplicação usam o telefone com hash; nenhum segredo nem token no registro.

## Parte 4 — Segurança, privacidade e comportamento
- **Somente leitura:** nenhuma ferramenta cria, altera ou cancela pedido, preço, desconto ou cadastro. Qualquer pedido de mudança vira link do cardápio ou chamada ao dono.
- **Nunca inventar:** preço, prazo, estoque, desconto, taxa e horário só saem do contexto recebido; se não constar, "vou confirmar com a loja" e `chamar_dono`/registro. Teste dedicado de perguntas armadilha.
- **Isolamento:** a IA só enxerga a loja da conversa e o cliente daquele telefone (e só se confirmado). Pergunta sobre outro cliente, outra loja ou "o que você sabe sobre mim" recebe resposta neutra; nada além do necessário entra no prompt.
- **Injeção de instruções:** texto do cliente e o campo livre do dono são **dados**, nunca instruções com autoridade (o prompt de sistema diz isso); o campo livre tem limite de tamanho e a IA não executa nada fora das três ferramentas.
- **Abuso e custo:** limite de mensagens por telefone por minuto/hora, teto de tamanho da mensagem, teto de passos por resposta, proteção contra laço (mensagem automática de outro robô), corte de custo por loja no mês.
- **LGPD:** o cliente iniciou a conversa; "parar" encerra e marca opt-out (nenhuma mensagem proativa nesta fase); retenção de 30 dias; "apagar meus dados" do perfil também apaga conversas daquele telefone naquela loja; aviso de que fala com um assistente automático na primeira resposta.
- **Tom:** português do Brasil simples, curto, sem prometer o que não está no contexto; sempre identifica que é um assistente automático.

## Parte 5 — Testes e liberação
- **Contrato/rota (Comanda, staging):** assinatura inválida, janela de 5 min, replay, corpo grande, loja inexistente igual a IA desligada, cliente sem telefone confirmado retorna `null`, dado de outra loja nunca aparece.
- **IA (CRM, avaliação offline):** conjunto fixo de perguntas e respostas esperadas (cardápio, horário aberto/fechado, taxa, adicional esgotado, pergunta sem resposta, reclamação, injeção de instruções, pedido de dado de outro cliente, pedido de desconto inventado, mensagem de áudio); a avaliação roda a cada mudança de prompt.
- **Webhook:** reenvio duplicado da Meta, mensagens fora de ordem, assinatura inválida, tipos não suportados.
- **Ponta a ponta no número real** com o celular do dono do produto na `qa-teste-varredura`, depois de o webhook ser reativado na Meta.
- **Liberação:** `ia_habilitada` nasce `false`; migrations e funções só por ordem do dono; primeiro só na loja de teste; medição de custo e de qualidade por uma semana antes de qualquer loja de cliente; nenhuma loja liga sozinha.

## Fora desta fase
Fechar pedido pela conversa e mandar Pix (fase 2), tela de conversas no Sai aê, número próprio por loja, áudio/imagem/localização, mensagens proativas ou campanhas, alterar ou cancelar pedido, status do pedido em tempo real pela conversa.

## Pontos para o plano de implementação (Review Focus)
1. Injeção de instruções pelo texto do cliente e pelo campo livre do dono.
2. Vazamento entre lojas e entre clientes (telefone de outro cliente, cliente sem telefone confirmado).
3. Webhook duplicado, fora de ordem ou reenviado pela Meta.
4. Janela de 24 horas: resposta livre fora da janela falha; o aviso ao dono precisa de modelo.
5. Custo fora de controle: laço de robôs, mensagens longas, limite mensal ultrapassado.
6. A IA inventando preço, prazo, desconto ou estoque.
