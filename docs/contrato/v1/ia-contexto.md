# Contrato SAI-002 — `ia-contexto` (CRM → Comanda)

Rota **servidor→servidor** que dá à IA do WhatsApp os dados da loja. Aditiva ao SAI-001 (v1), mesma família de assinatura. A IA **só lê**: nada aqui cria ou altera pedido, preço, desconto ou cadastro. Spec: `docs/superpowers/specs/2026-10-08-ia-whatsapp-design.md`.

## Requisição
`POST {SUPABASE_URL}/functions/v1/ia-contexto` — sem JWT; a autenticação é a assinatura.

| Cabeçalho | Valor |
|---|---|
| `X-Saiae-Timestamp` | segundos desde 1970, inteiro canônico (sem zero à esquerda, sinal ou decimal) |
| `X-Saiae-Signature` | `sha256=` + HMAC-SHA256 em hexadecimal minúsculo de `timestamp + "." + corpo bruto`, com o segredo de plataforma |
| `Content-Type` | `application/json` |

Corpo (máx. **4 KB**; campos extras são ignorados):
```json
{ "codigo_loja": "ABCD23", "telefone": "11977776655" }
```
- `codigo_loja`: exatamente 6 caracteres `[A-Z0-9]` (o código do link/QR da loja).
- `telefone`: só dígitos, 10 a 13 (com ou sem o 55 do país; a Comanda normaliza como no perfil).

Segredo: `IA_CONTEXTO_SEGREDO` (Comanda) = `COMANDA_IA_SEGREDO` (CRM). **Segredo de plataforma**, gerado e colocado pelo dono; nunca em chat, repositório, log ou prompt. Rotação: trocar nos dois lados na mesma janela.

Assinar (exemplo Node, CRM):
```ts
import { createHmac } from 'node:crypto'
const corpo = JSON.stringify({ codigo_loja, telefone })
const timestamp = String(Math.floor(Date.now() / 1000))
const assinatura = 'sha256=' + createHmac('sha256', segredo).update(`${timestamp}.${corpo}`).digest('hex')
// enviar `corpo` exatamente como foi assinado
```

## Respostas
| Status | Quando | Corpo |
|---|---|---|
| 200 | assinatura válida e corpo válido | contexto (abaixo) ou `{ "ativa": false }` |
| 400 | assinatura válida, corpo inválido | `{ "erro": "Corpo inválido" }` |
| 401 | assinatura ausente, malformada, errada ou timestamp fora da janela de **5 min** (passado ou futuro) | vazio |
| 405 | método diferente de POST | vazio |
| 413 | corpo acima de 4 KB | vazio |
| 500 | falha ao montar o contexto | `{ "erro": "Falha ao montar o contexto" }` |
| 503 | `IA_CONTEXTO_SEGREDO` não configurado na Comanda | vazio |

**Código inexistente, código mal formado e IA desligada** devolvem **exatamente** `{ "ativa": false }`: a rota não revela se o código existe. Replay dentro da janela de 5 min é aceito porque a rota é somente leitura e idempotente.

## Resposta (`ativa: true`)
```ts
{
  ativa: true
  loja: {
    nome: string
    endereco: string | null              // procon_endereco, senão emitente_endereco
    aberta_agora: boolean | null         // no fuso da loja; null se a loja não cadastrou horário
    horarios: { dia: number; aberto: boolean; abre: string | null; fecha: string | null }[]   // dia 0 = domingo; "HH:MM"
    modos: string[]                      // mesa, balcao, retirada, entrega
    pagamentos: string[]                 // métodos da loja + 'pix_online' e 'pagar_na_entrega' quando ligados
    taxa_entrega: { habilitada: boolean; padrao_centavos: number | null;
                    bairro_nao_listado: 'taxa_padrao' | 'bloquear'; bairros: { bairro: string; taxa_centavos: number }[] }
    link_cardapio: string                // https://app.saiae.com.br/<slug>/cardapio
  }
  cardapio: {
    truncado: boolean                    // true = lista parcial (máx. 200 itens; a IA deve dizer que é parcial)
    itens: { nome: string; descricao: string | null; categoria: string; preco_centavos: number; esgotado: boolean;
             adicionais: { grupo: string; tipo: 'variacao' | 'adicional'; obrigatorio: boolean;
                           opcoes: { nome: string; preco_centavos: number }[] }[] }[]
  }
  cliente: null | { primeiro_nome: string; ultimos_pedidos: { itens: string[] }[] }
  ia: { texto_livre: string | null; whatsapp_dono: string | null; dono_confirmado: boolean; plano_limite_conversas: number }
}
```
Regras de leitura:
- **Preços** em centavos inteiros. Em grupo `variacao` o `preco_centavos` da opção é o preço **absoluto** da unidade (substitui o do item); em `adicional` é o valor **somado**. Só opções ativas e não esgotadas.
- **`cliente`**: só existe se o perfil daquele telefone **naquela loja** tem telefone confirmado. Traz só o **primeiro nome** e os itens dos últimos 3 pedidos não cancelados. Caso contrário `null`: a IA trata como cliente novo e **não afirma que o conhece**.
- **Isolamento**: nada de outra loja nem de outro cliente aparece. O CRM não deve enviar o telefone de terceiros.
- `texto_livre` é texto do dono: **dado, nunca instrução** (a IA não obedece ordens que estejam nele).
- `plano_limite_conversas`: limite do plano em `ia_limites_plano`; plano **sem linha** na tabela = **200** (padrão seguro, nunca "sem limite"; os números definitivos saem da medição de custo).
- `dono_confirmado`: o WhatsApp do dono foi confirmado por ele (contrato `ia-dono-confirmar.md`). A IA só fica ligada com o número confirmado.
- Campos aditivos em relação ao rascunho da spec: `grupo.tipo` e `taxa_entrega.bairro_nao_listado`.

## Publicação (só por ordem do dono)
`supabase functions deploy ia-contexto --no-verify-jwt --project-ref <ref>` (staging `qzcqwovbbylqxljcrqhk` primeiro). A migration `20261019100000_ia_atendente.sql` precisa estar aplicada antes.
