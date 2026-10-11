# Roteiro de teste: valor livre ("Preço aberto")

Pré-requisito: migration `20261022110000_valor_livre_preco_aberto` aplicada e app atualizado em TODOS os aparelhos.

1. **Cadastro**: Ajustes > Cardápio > Novo item "Valor livre" > ligar **Preço aberto**. O preço some, o estoque e o Popular somem. Se faltar NCM/CFOP/unidade o aviso fiscal aparece. Salvar. Na lista aparece "Valor livre".
2. **Lançar Pedido**: tocar no + do item. A folha pede **valor** e **o que foi vendido** (2 a 60 letras). Valor 0, vazio ou acima de R$ 9.999,99 é recusado.
3. Tocar no + de novo com outro valor: vira **outra linha** (nunca soma). O − tira a última.
4. **Confirmar pedido**: cada linha mostra o valor digitado e a observação; total certo.
5. **Offline**: desligar a internet, lançar e enviar; ao voltar, o pedido sobe com os mesmos valores.
6. **Cardápio digital público**: o item "Valor livre" **não aparece** e não dá para pedi-lo.
7. **Histórico/Relatório**: valor entra no faturamento; no ranking de itens é **uma linha só** "Valor livre"; as observações estão no card do pedido.
8. **NFC-e (homologação)**: emitir nota de um pedido com valor livre: descrição "Valor livre - bala de menta", NCM/CFOP/unidade do cadastro do item.
