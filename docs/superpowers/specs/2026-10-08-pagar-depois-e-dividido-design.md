# Especificação: pagar depois (Retirada e Entrega) e pagamento dividido

Data: 2026-10-08. Autor: orquestrador. Estado: **Fase 1 APROVADA pelo João (seção 9); Fase 2 só depois que o João validar a Fase 1 em uso real.** Cópia de `saiae-plano-agil/SPEC-PAGAR-DEPOIS-E-DIVIDIDO.md`.
Origem: pedido do cliente (restaurante do Paulo), marcado por ele como "muito importante" (item H1 do backlog).

## 1. O problema, nas palavras do cliente
O pedido chega pelo WhatsApp. A cozinha precisa começar já, mas o operador **não sabe como o cliente vai pagar** até ele retirar (o cliente diz "Pix" e paga em dinheiro). Hoje é obrigatório escolher a forma na hora de lançar. Isso gera forma errada, e a **NFC-e e o imposto dependem da forma de pagamento verdadeira**. Ele quer dar baixa no pagamento quando o cliente retira, e ali sair a nota e o comprovante.

## 2. O que já existe e vamos reaproveitar (verificado no código da main)
- Valor de pagamento **`na_entrega`** em `pedidos.metodo_pagamento` (migration 20261006160000). Hoje só nasce no **cardápio digital** e, no app, só é oferecido em Confirmar Pedido para **Entrega** (`ConfirmarPedido.tsx`, opção `METODO_NA_ENTREGA`).
- O método real é definido depois pelo **entregador** (link `/e/<token>`, `entregador_confirmar`) ou pelo **operador** (`definir_metodo_pagamento`, botão `BotaoDefinirPagamento` no Histórico, só online).
- `definir_metodo_pagamento` **só funciona quando o método atual é `na_entrega`** e nunca sobrescreve um método já definido.
- `emitir-nfce` **recusa** pedido `na_entrega` e hoje monta **uma única** forma de pagamento (`formas_pagamento: [{ forma_pagamento, valor_pagamento: valorTotal }]`).
- Relatório (`relatorio.ts`) tem a categoria `na_entrega`; a Caixa conta dinheiro por `metodo_pagamento = 'dinheiro'` (`SecaoCaixa.tsx`).
- Evento SAI-001 "pagamento definido" já é emitido por trigger quando o método sai de `na_entrega` (migration 20261016110000).

## 3. Decisões do João (2026-10-08)
1. Vale para **Retirada e Entrega**.
2. Dá para **corrigir a forma de pagamento depois de entregue**, **enquanto a NFC-e não foi emitida**.
3. **Pagamento dividido entra** (mais de uma forma no mesmo pedido).
4. Atrás de um **interruptor por barraca**, ligado só no cliente que pediu depois de validar.

## 4. Proposta (sequência recomendada)

### 4.1 Fase 1: "Pagar depois" (sem divisão) — entrega o ganho principal
- **Em Confirmar Pedido**, nos modos Retirada e Entrega, aparece a opção **"Pagar depois"** (rótulo "Pagar na retirada" em Retirada e "Pagar na entrega" em Entrega). Internamente reaproveita o valor `na_entrega` (nome interno mantido de propósito, para não mexer em constraint, eventos, entregador e relatórios). Só aparece com o interruptor da barraca ligado.
- O pedido vai à cozinha e a comanda é impressa normalmente. A comanda mostra **"PAGAMENTO: A RECEBER"** no lugar de "Forma de pagamento".
- **Na Cozinha e no Histórico**, pedido com pagamento pendente leva uma etiqueta "A receber".
- **Ao tocar "Entregue"** em um pedido com pagamento pendente, o app abre a escolha da forma (dinheiro, débito, crédito, Pix) antes de concluir. Pode escolher "Receber depois" para concluir sem definir (volta a ficar pendente no Histórico, com o botão de definir já existente).
- **Dinheiro:** campo opcional "valor recebido" para calcular troco (só informativo).
- **Offline:** definir a forma entra na **fila de sincronização** (nova operação `definir_metodo`), idempotente por `client_uuid` + pedido. Hoje `definir_metodo_pagamento` é só online; a fila resolve o balcão sem rede.
- **Correção depois de entregue:** nova RPC `corrigir_metodo_pagamento` (aditiva) que permite trocar a forma **enquanto `nfce_status` for nulo ou com erro** e o pedido não for cancelado; registra quem e quando. `definir_metodo_pagamento` continua como está. Depois que a NFC-e é autorizada, **trava** (para mudar, é o fluxo fiscal de cancelamento, fora de escopo).

### 4.2 Fase 2: Pagamento dividido
- **Modelo:** tabela nova `pedido_pagamentos` (pedido_id, barraca_id, metodo, valor_centavos, criado_em). `pedidos.metodo_pagamento` continua existindo: com **uma** forma, fica igual à de hoje; com **duas ou mais**, vira o valor novo **`misto`** (precisa entrar no CHECK, aditivo). Regra: a soma das parcelas deve ser igual ao total pago do pedido (total do pedido já considera cupom e taxa de entrega conforme a regra vigente).
- **Tela:** ao definir o pagamento, botão "Dividir": o operador adiciona linhas (forma + valor). O app mostra quanto falta. Só conclui com a soma exata.
- **Relatórios e taxas de maquininha:** cada parcela entra na sua forma (faturamento por forma e taxa de débito/crédito aplicada sobre a parcela). `misto` nunca aparece sozinho em relatório: é desdobrado.
- **Caixa:** o dinheiro esperado soma só as **parcelas** em dinheiro (hoje conta pedido inteiro com `metodo_pagamento = 'dinheiro'`).
- **NFC-e:** `emitir-nfce` passa a montar `formas_pagamento` com **uma entrada por parcela** (a FocusNFe aceita lista). Cuidado fiscal: a soma das formas precisa bater com o valor da nota (já respeita desconto de cupom e total grátis). Pedido sem parcelas válidas continua recusado.
- **Evento SAI-001:** o evento de pagamento definido passa a levar a lista de parcelas (campo novo, aditivo); consumidores antigos que só leem `metodo` continuam funcionando (`metodo` = `misto`).
- **Impressão:** a comanda e o comprovante listam as parcelas.

### 4.3 Interruptor por barraca
- Coluna `barracas.pagamento_depois_habilitado boolean not null default false` (aditiva). A tela de Ajustes ganha um toggle em "Cardápio & Operação". Com ele desligado, o app se comporta exatamente como hoje.
- Como não há regra de produto que impeça, o pagamento dividido só aparece com o interruptor ligado.

## 5. Impacto técnico (checklist para a implementação)
Banco (todas as mudanças aditivas, em migration única por fase):
- `pedidos_metodo_pagamento_check`: aceitar `misto` (fase 2).
- Tabela `pedido_pagamentos` com RLS por `usuario_tem_acesso_barraca` (fase 2).
- Coluna `barracas.pagamento_depois_habilitado` (fase 1).
- RPCs: `corrigir_metodo_pagamento` (fase 1); `definir_pagamentos(p_pedido_id, p_parcelas jsonb)` que valida a soma e grava as parcelas (fase 2).
- Fila offline: nova operação em `useSincronizacao` com retrocompatibilidade (versão antiga do app ignora a operação nova: tratar `PGRST202`/operação desconhecida como adiada, igual ao padrão da v6).
App:
- `ConfirmarPedido.tsx` (opção "Pagar depois" por modo), `Cozinha.tsx` e `DetalheComanda.tsx` (etiqueta e modal ao Entregue), `Historico.tsx` (corrigir e dividir), `SecaoCaixa.tsx` (dinheiro por parcela), `relatorio.ts` (desdobrar `misto`, taxa por parcela), `impressoraTermica.ts` (linhas de pagamento), `Entregador.tsx` (continua escolhendo uma forma; divisão só pelo operador).
Edge Functions: `emitir-nfce` (várias formas), `criar-pedido-cardapio` (inalterado).
Contrato SAI-001: evento de pagamento com parcelas (aditivo).

## 6. Riscos e como mitigamos
- **Fiscal:** forma errada na nota. Mitigação: nota só com pagamento definido; soma das parcelas validada no banco; correção permitida só antes da emissão; testes de emissão em homologação com forma única e com duas formas.
- **Relatórios e Caixa:** pedido pendente não pode inflar o faturamento nem o caixa de dinheiro. Mitigação: pendente aparece separado ("a receber"), como o `na_entrega` já aparece hoje.
- **Clientes em produção:** mudança atrás de interruptor, migrations aditivas, aplicadas fora do horário de uso, versão antiga do app continua funcionando (fila e RPCs antigas intactas).
- **Offline:** definição de forma na fila, idempotente; conflito (dois aparelhos definem formas diferentes) resolvido por "primeiro que sincroniza vence" com aviso ao segundo.

## 7. Fora de escopo
Cancelamento de NFC-e já autorizada; cobrança de Pix por QR na retirada (o Pix aqui é só registro da forma); parcelamento no cartão; propinas/gorjeta; pagamento de Mesa (pode vir depois com o mesmo mecanismo).

## 8. Critérios de aceite resumidos
Fase 1: com o interruptor ligado, lançar Retirada com "Pagar depois" imprime a comanda com "A RECEBER", aparece como pendente, e ao tocar "Entregue" o operador escolhe a forma; a NFC-e sai com a forma escolhida; corrigir a forma antes da nota funciona e depois da nota é bloqueado; sem rede, a escolha sincroniza depois; com o interruptor desligado nada muda.
Fase 2: dividir em duas ou mais formas com soma exata; relatório, taxas, Caixa e NFC-e usam as parcelas; soma diferente do total é recusada.

## 9. Respostas do João (2026-10-08) — spec APROVADA para a Fase 1
1. Mesa e Balcão: **fora de escopo agora** (só Retirada e Entrega).
2. Pix na retirada: **só registra a forma**, sem gerar QR code.
3. Corrigir a forma depois de entregue: **só o dono** (exige a senha administrativa).
4. Interruptor: **ligar primeiro no restaurante do Paulo**; o Sabor Kawashima depois.
