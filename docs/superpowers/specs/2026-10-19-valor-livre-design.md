# Produto de valor livre ("Preço aberto") — spec curta (H6)

Estado: **proposta para o João**. Só documento; nenhuma linha de código. Origem: feedback do Sabor Kawashima (bomboniere), backlog H6.

## 1. O problema
O operador vende coisas sem preço fixo (uma bomboniere de R$ 0,50 a R$ 4,00; um valor combinado diferente para quem capta clientes na frente do INSS). Hoje todo item tem preço cadastrado, então ele não consegue lançar "R$ 1,35, bala de menta" e o caixa não fecha certinho.

## 2. Comportamento proposto
- **Cadastro:** no item (Ajustes › Cardápio), opção **"Preço aberto"**. Com ela ligada, o preço do cadastro some (fica 0 de reserva) e o item mostra "Valor livre" no lugar do preço.
- **Lançar Pedido:** ao tocar no item "Preço aberto", abre uma folha pedindo **valor** (teclado numérico, centavos, obrigatório e maior que zero) e **o que foi vendido** (texto curto, obrigatório, 2 a 60 caracteres). Confirmar põe a linha no carrinho com aquele valor. Cada toque cria uma **linha própria** (não soma quantidade com outro valor); quantidade fica 1 (editável só se o valor for por unidade, decisão 5).
- **Carrinho / Confirmar Pedido:** a linha mostra "Valor livre — bala de menta" e o valor digitado; tocar nela reabre a folha para corrigir antes de enviar.
- **Dinheiro e troco, cupom, taxa:** nada muda (o valor entra no total como qualquer item).

## 3. Modelo de dados (aditivo)
- `itens.preco_aberto boolean not null default false`.
- A linha do pedido continua em `itens_do_pedido`: `item_id` = o item "Valor livre", `nome_item` = nome do cadastro, **`preco_centavos_unitario` = o valor digitado**, **`observacao` = o que foi vendido**. Nenhuma coluna nova em `itens_do_pedido`; `criar_pedido` já recebe o preço no payload do operador, então **não muda**.
- **Servidor confia no operador, não no cliente final:** o item "Preço aberto" **nunca** vai para o cardápio digital público (`cardapio_publico` o oculta e o `resolver_carrinho` recusa), senão o cliente digitaria o próprio preço. Essa é a regra de segurança central.

## 4. Onde aparece
| Área | Regra |
|---|---|
| **Comanda impressa** | Linha do item com a observação embaixo (como hoje): "Valor livre / bala de menta  R$ 1,35". Sem mudança de layout. |
| **Cozinha / Detalhe** | A observação do item já aparece como alerta; basta. |
| **Relatório / Faturamento** | O valor entra no faturamento normalmente. No ranking de itens, "Valor livre" vira **uma linha só** (soma e quantidade), sem tentar separar por observação. As observações ficam no Histórico (card do pedido). |
| **Estoque** | Item "Preço aberto" **não controla estoque** (a opção de estoque some no cadastro). |
| **Cupom** | Funciona sobre o total como qualquer item (cardápio digital não oferece o item, então o caso é só do balcão, que não usa cupom). |
| **NFC-e** | Usa o NCM/CFOP/unidade **genéricos cadastrados no próprio item "Valor livre"**. A descrição do produto na nota é **nome do item + o que foi vendido** (ex.: "Valor livre - bala de menta"), para não emitir uma descrição vaga. Se faltar NCM, CFOP ou unidade, o `emitir-nfce` já recusa dizendo qual campo falta; **além disso** Ajustes avisa na hora de ligar "Preço aberto" com os dados fiscais incompletos ("sem NCM/CFOP/unidade, a nota deste item não sai"). |
| **Offline** | Funciona sem rede: item e flag vêm do cache de itens do aparelho; o valor e a observação viajam no payload do `criar_pedido` na fila, como qualquer pedido. |
| **Eventos para o CRM** | Sem mudança (o item vai com nome e valor; consumidores não precisam saber do flag). |

## 5. Riscos
- **App antigo em aparelho não atualizado** não conhece o flag e venderia o item pelo preço de reserva (R$ 0,00). Mitigação: avisar o dono para ligar "Preço aberto" só depois de atualizar os aparelhos; o preço de reserva do cadastro fica em R$ 0,00 de propósito (visível, não passa despercebido).
- **Fiscal:** descrição genérica na nota. Mitigação: descrição = nome + observação obrigatória; NCM/CFOP genéricos escolhidos pelo contador do dono (a tela explica); testar em homologação antes de uso real (nenhuma nota foi emitida de verdade ainda).
- **Abuso interno** (operador lança valor menor): é o objetivo do recurso; o Histórico mostra cada valor e a observação. Limite por linha sugerido: R$ 9.999,99.

## 6. Decisões para o João
1. A observação "o que foi vendido" é **obrigatória** (recomendado, por causa da nota) ou opcional?
2. A descrição da nota deve ser **nome + observação** (recomendado)?
3. O ranking de itens agrupa tudo em "Valor livre" (recomendado) ou queremos agrupar por observação?
4. Limite de valor por linha (sugestão R$ 9.999,99)?
5. Quantidade editável no item de preço aberto (valor por unidade) ou sempre 1 por linha (recomendado)?

## 7. Plano (PRs pequenos, depois da aprovação)
1. Migration: `itens.preco_aberto` + `cardapio_publico`/`resolver_carrinho` ignoram e recusam o item; testes.
2. Cadastro em Ajustes (toggle, preço de reserva, aviso fiscal) + tipos.
3. Lançar Pedido: folha de valor e observação, linha própria no carrinho, edição, offline; testes.
4. Comanda, relatório (ranking), `emitir-nfce` (descrição = nome + observação); testes e roteiro de homologação.

## 8. Fora de escopo
Preço aberto no cardápio digital público; sugestões de valor; produto fracionado por peso; leitor de código de barras.
