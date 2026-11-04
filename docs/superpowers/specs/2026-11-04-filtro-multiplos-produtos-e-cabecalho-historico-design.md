# Filtro de vários produtos/categorias e cabeçalho fluido do Histórico

Data: 2026-11-04. Origem: pedido do dono em conversa de brainstorm. App: `saiae-app` (app.saiae.com.br).

## Intenção e motivo

O dono quer ver "exatamente o que quer" no Faturamento e no Histórico. O exemplo dele: saber quantas bebidas com embalagem e quantos pratos feitos vendeu, somados, num período. Hoje só dá para escolher um produto por vez, e o cabeçalho do Histórico incomoda ao usar: ocupa muito espaço e some de repente ao rolar.

## Mudanças

### 1. Filtro de vários produtos e categorias (Faturamento e Histórico)

- O seletor único "Todos os produtos" (hoje um `<select>` com um produto por vez em `src/pages/Desktop.tsx` e `src/pages/Historico.tsx`) vira uma seleção múltipla.
- O dono marca produtos um a um, e também marca uma categoria inteira de uma vez (a categoria marca todos os produtos dela). Os produtos têm `categoria_id`, ligado à tabela `categorias` (nome e ordem).
- Sem nada marcado, tudo continua como hoje (todos os produtos).
- **Faturamento:** com seleção, o painel mostra o relatório "produto isolado" somado sobre todos os itens marcados: valor (R$), unidades, gráfico de evolução no período e comparação com o período anterior, com o seletor R$/Unidades que já existe. Hoje `useRelatorio` recebe um `itemFiltradoId` único e `agregarProdutoIsolado` filtra por um `item_id`; a base é generalizar isso para um conjunto de ids.
- **Histórico:** mostra só as comandas que contêm pelo menos um dos itens marcados (hoje: `some(item.item_id === itemFiltradoId)`). Exportar e "Apagar período" continuam agindo sobre as comandas exibidas, como hoje.

### 2. Cabeçalho do Histórico fluido (opção B escolhida)

- No topo da página: cabeçalho completo como hoje (período, produto, busca, tipo de consumo, método de pagamento).
- Ao rolar: os filtros recolhem aos poucos, sem sumir de repente, e sobra uma linha fina fixa. A linha fina leva período, busca e um botão de filtros (palpite do assistente, o dono só escolheu a opção B).
- O cabeçalho nunca desaparece por completo. Hoje `useOcultarAoRolar` esconde tudo de uma vez com `translate-y-full` e há um botão flutuante "Filtros" para voltar.

## Objetivos

- Soma correta de qualquer combinação de produtos e categorias, no período escolhido.
- Menos espaço ocupado e transição suave no Histórico.

## Fora do escopo (não-objetivos)

- Novos tipos de filtro além de produto e categoria (embalagem, tipo de atendimento ou método de pagamento no Faturamento).
- Criar um campo de "embalagem" nos produtos. Não existe no cadastro hoje. O dono monta "bebidas com embalagem" marcando produtos ou categorias já existentes.
- Mudar o relatório completo (sem seleção), a exportação do Faturamento ou os planos Essencial/Pro.

## Anti-objetivos (seria falha mesmo funcionando)

- Totais que não batem com a soma dos produtos marcados, ou que contam comandas canceladas ou itens removidos (hoje ambos são ignorados no produto isolado).
- Cabeçalho que cubra a lista ou pule ao rolar.
- Piorar o uso no celular, que é o uso principal.

## Restrições

- Manter a stack e os padrões do app: React, Supabase, componentes em `src/components/ui`, tema claro/escuro.
- Respeitar o plano Essencial (histórico de 7 dias, sem exportar) e a senha administrativa (`GateSenhaAdmin`).
- O app também roda em Android (Capacitor): nada de recurso exclusivo de desktop.

## Decisões do dono

- Seleção múltipla de produtos e de categoria inteira, nas duas telas.
- Cabeçalho do Histórico no estilo "encolhe aos poucos ao rolar".

## Deixado para quem constrói

- O visual do seletor múltiplo (lista com caixas de marcar, gaveta, agrupamento por categoria).
- O que mostrar na linha fina do cabeçalho recolhido, mantendo período, busca e acesso aos filtros.
- Como buscar os pedidos com vários itens no Supabase (várias consultas ou um filtro `in`).
- Como lidar com produtos desativados que ainda aparecem em vendas antigas.
