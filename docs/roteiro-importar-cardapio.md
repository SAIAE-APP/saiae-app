# Roteiro de teste: importar cardápio por planilha

Sem migration: a gravação usa a RLS de sempre (inserts em lote). Vale para o dono e para o suporte com acesso ativo.
Teste primeiro numa barraca de teste. Confira cada passo em **360 px** (celular) e em **768 px** (tablet/desktop).

1. **Ajustes > Cardápio & Operação > Cardápio**: ao lado de "Categorias" e "Novo item" aparece **Importar de planilha**. Em 360 px os botões quebram em duas linhas, sem vazar da tela.
2. Toque nele: abre a folha **Importar cardápio** com o texto das colunas, o link **Baixar planilha modelo** e **Escolher arquivo**.
3. **Baixar planilha modelo**: baixa `modelo-cardapio.csv` (cabeçalho Categoria, Nome, Preço, Descrição, Ativo e 3 exemplos). Abra no Excel/Planilhas: os acentos aparecem certos.
4. Escolha o próprio modelo: a **prévia** mostra **3 itens novos**, **2 categorias novas**, 0 já existem, 0 com erro, e a tabela com as linhas (rola para o lado em 360 px). Escreve "Nada foi gravado ainda".
5. **Importar 3 itens**: mostra "Importando... N de 3" e depois **Importação concluída: 3 itens criados, 2 categorias criadas, 0 já existiam, 0 com erro**. **Fechar**: a lista de itens e as categorias já mostram o que entrou (ordem depois dos itens que já existiam).
6. Importe o **mesmo arquivo de novo**: prévia com 0 itens novos / 3 já existem; não há botão de importar ("Não há nenhum item novo"). Nada duplica.
7. Planilha com erros (use `tests/fixtures/cardapio-exemplo.csv`): "Linha 7: preço inválido"; as outras linhas entram se confirmar. Teste também: nome vazio ("Linha N: nome vazio"), preço vazio/zero, "Ativo" com texto estranho.
8. **Preços**: `12`, `12,5`, `12,50`, `R$ 12,50`, `12.50` valem; `1.234` e `1,234` são recusados como ambíguos (use `1234,00`).
9. **Categoria**: vazia ou "Sem categoria" fica sem categoria; "pasteis" e "Pastéis" são a mesma categoria (não duplica, nem com a que já existia).
10. **Preço aberto**: com a coluna "Preço aberto" = sim, o item entra com preço R$ 0,00 e valor livre.
11. **.xlsx**: repita 4 e 5 com a planilha salva como .xlsx (1ª aba).
12. **Limite**: um arquivo com 301 linhas mostra "O arquivo tem 301 linhas; o máximo é 300 por arquivo."
13. **Sem internet**: escolher o arquivo mostra "Sem internet" e não grava nada.
14. O que **não** entra: fotos (adicione depois pelo item), NCM/CFOP/unidade (campos fiscais ficam vazios), estoque. Itens que já existiam nunca são alterados nem apagados.
