# Dívida técnica: `react-hooks/set-state-in-effect`

A regra está como **aviso** (`warn`) em `eslint.config.js` desde o PR de CI/staging. Todo o resto do lint continua como erro no CI.

Motivo: as 13 ocorrências são o padrão `setCarregando(true)` no início de um fetch dentro de `useEffect`, ou a leitura de cache offline no mesmo efeito. Corrigir de verdade muda o fluxo de carregamento (inclusive o do app instalado sem conexão), então fica para PRs próprios, um por arquivo, com teste manual.

| Arquivo | Linha |
|---|---|
| `src/components/GateFaceId.tsx` | 49, 68 |
| `src/components/SecaoCustoLucro.tsx` | 110 |
| `src/hooks/useAssinaturaBarraca.ts` | 51 |
| `src/hooks/useBarraca.ts` | 70 |
| `src/hooks/useBarracasDoUsuario.ts` | 63 |
| `src/hooks/useEvolucao14Dias.ts` | 19 |
| `src/hooks/useRelatorio.ts` | 191 |
| `src/pages/Assinar.tsx` | 30 |
| `src/pages/Assinatura.tsx` | 72 |
| `src/pages/Dashboard.tsx` | 126 |
| `src/pages/Historico.tsx` | 454 |
| `src/pages/LancarPedido.tsx` | 536 |

O CI roda `eslint --max-warnings 13`: a dívida não pode crescer. Ao corrigir um arquivo, baixe o número em `package.json` (script `lint`) e remova a linha daqui. Quando chegar a zero, volte a regra para `error`.
