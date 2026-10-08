# Perfil do cliente final — plano de implementação (lado CRM)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Este plano é executado no repositório do CRM** (`centraldeatendimentoaia-cyber/saiae-crm`, clone `C:\Users\AORUS\Projetos\saiae-crm`), pela sessão do CRM (aorus-03). A cópia fica no repositório da Comanda só porque o contrato é compartilhado.

**Goal:** Receber da Comanda o pedido de envio do código de verificação do cliente final e enviá-lo pelo **modelo de autenticação** da WhatsApp Cloud API, sem guardar o código nem o telefone.

**Architecture:** Uma rota nova `POST /api/integracao/comanda/v1/codigo-verificacao`, no mesmo padrão da rota de eventos (assinatura HMAC, janela de 5 min, corpo bruto), usando o `CloudApiProvider` já existente. A autenticação é por um **segredo de plataforma** (`COMANDA_CODIGO_SECRET`), não por barraca. Estende `sendTemplate` com o parâmetro do botão "copiar código", exigido pelos modelos de autenticação.

**Tech Stack:** Next.js 16 (route handlers), TypeScript, zod, vitest/jest do projeto (ver os testes existentes `route.test.ts`), WhatsApp Cloud API.

**Spec:** `docs/superpowers/specs/2026-10-08-perfil-cliente-final-design.md` (repositório da Comanda, PR #69), Partes 2 e 3. Plano irmão: `2026-10-08-perfil-cliente-final-comanda.md` (Task 3 define o chamador).

## Global Constraints
- **Sem mudança de schema** (`schema.prisma` intocado: o CRM roda `prisma db push` em todo start e qualquer mudança vai direto à produção).
- O CRM **não guarda** código, telefone nem corpo; o log tem só o resultado (`enviado`, código de erro da Meta, motivo fixo). Nunca telefone, nunca código.
- Assinatura idêntica à dos eventos: `X-Saiae-Event-Id` (= `request_id`), `X-Saiae-Timestamp` (segundos), `X-Saiae-Signature = "sha256=" + HMAC-SHA256(segredo, timestamp + "." + corpo bruto)`; janela de 5 min; comparação em tempo constante (reutilizar `verifyComandaSignature`, `parseTimestamp`, `timestampInWindow` de `src/modules/integracao/comanda/signature.ts`).
- Resposta de recusa idêntica nos casos de assinatura inválida, janela vencida e cabeçalhos ausentes (`401 { error: "Não autorizado" }`).
- Sessão Cloud API vem do env `WHATSAPP_CLOUD_SESSION_ID` (mesma regra do piloto). Se não estiver configurada: `503`, nunca cair para Baileys.
- Limite de corpo 4 KB; `telefone` só dígitos (10 ou 11, sem 55; o CRM acrescenta o 55 ao enviar); `codigo` só 6 dígitos; `request_id` e `barraca_id` UUID.
- Idempotência por `request_id` em memória (janela de 10 min): a Comanda pode repetir a chamada e o cliente não pode receber dois códigos iguais pela mesma tentativa.
- Segredos só na Railway; nunca no repositório.

## Review Focus
1. **Mesma chamada repetida (`request_id` igual)** → responde `200 { enviado: true, duplicate: true }` sem enviar de novo (Task 2).
2. **Telefone com máscara, 55, sem DDD ou com letras** → `422` sem ecoar o valor (Task 2).
3. **Meta recusa (janela fechada não se aplica a autenticação, mas número inválido ou modelo pendente)** → `422/502` conforme o tipo de erro, sem vazar o telefone nos logs (Task 2).
4. **Segredo não configurado** → `503` e jamais aceitar sem assinatura (Task 2).
5. **Modelo de autenticação com botão "copiar código"** → o payload à Meta leva o código no corpo **e** no botão; sem o botão a Meta rejeita (Task 1).

## File Structure
- Modify: `src/modules/whatsapp/cloud/` — `sendTemplate` e o tipo de parâmetros (localizar com `grep -rn "sendTemplate" src/modules/whatsapp`).
- Create: `src/modules/integracao/comanda/codigo.ts` — validação do corpo e idempotência.
- Create: `src/app/api/integracao/comanda/v1/codigo-verificacao/route.ts` e `route.test.ts`.
- Modify: `src/proxy.ts` — liberar o caminho exato (rota pública, como a de eventos).
- Modify: `docs/INTEGRACAO_COMANDA_EVENTOS.md` — seção do código de verificação e a env nova.

---

### Task 1: `sendTemplate` aceita o botão de código (modelo de autenticação)

**Files:**
- Modify: arquivo que define `sendTemplate` do `CloudApiProvider` (achar com `grep -rn "sendTemplate" src/modules/whatsapp`), a interface `WhatsAppProvider` e o tipo de entrada.
- Test: o `.test.ts` ao lado (ou criar `cloud/template.test.ts`).

**Interfaces:**
- Consumes: payload atual `{ name, languageCode, bodyParameters? }`.
- Produces: `{ name, languageCode, bodyParameters?, buttonParameters?: string[] }`; quando `buttonParameters` existir, o payload à Meta ganha `{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text }] }`.

- [ ] **Step 1: Teste que falha** — montar o corpo que seria enviado à Graph API para `{ name: "codigo_verificacao", languageCode: "pt_BR", bodyParameters: ["123456"], buttonParameters: ["123456"] }` e afirmar que `components` tem o corpo com `123456` **e** o botão `url` índice `0` com `123456`; e que sem `buttonParameters` o payload é idêntico ao de hoje (regressão do template `pedido_em_preparo`). Seguir o estilo dos testes do `CloudApiProvider` existentes (mock de `fetch`).
- [ ] **Step 2: Rodar** o teste isolado e ver falhar.
- [ ] **Step 3: Implementar** a extensão mínima em `sendTemplate`: acrescentar o componente de botão só quando `buttonParameters?.length`.
- [ ] **Step 4: Rodar** o teste novo e a suíte do módulo `whatsapp`: tudo verde (nenhum teste antigo muda).
- [ ] **Step 5: Commit** — `git commit -m "feat(whatsapp): sendTemplate aceita parâmetros de botão (modelo de autenticação)"`

---

### Task 2: Rota `POST /api/integracao/comanda/v1/codigo-verificacao`

**Files:**
- Create: `src/modules/integracao/comanda/codigo.ts`
- Create: `src/app/api/integracao/comanda/v1/codigo-verificacao/route.ts`
- Create: `src/app/api/integracao/comanda/v1/codigo-verificacao/route.test.ts`
- Modify: `src/proxy.ts`

**Interfaces:**
- Consumes: `verifyComandaSignature(rawBody, timestamp, header, secrets)`, `parseTimestamp`, `timestampInWindow`; `getProvider(sessionId)` de `@/modules/whatsapp/provider`; `sendTemplate` estendido (Task 1); `CloudApiError` e o mapa `STATUS` por tipo (copiar o mapa da rota `/template`).
- Produces: `validarPedidoCodigo(json): { ok: true; dados: { barraca_id; telefone; codigo; request_id } } | { ok: false }`; `jaEnviado(requestId): boolean` e `marcarEnviado(requestId)` (mapa em memória, TTL 10 min, teto 10 mil); a rota.

- [ ] **Step 1: Escrever `codigo.ts`**
```ts
import { z } from "zod";

const UUID = z.string().uuid();
const schema = z.object({
    barraca_id: UUID,
    telefone: z.string().regex(/^[0-9]{10,11}$/),
    codigo: z.string().regex(/^[0-9]{6}$/),
    request_id: UUID,
}).strict();

export type PedidoCodigo = z.infer<typeof schema>;

export function validarPedidoCodigo(json: unknown): { ok: true; dados: PedidoCodigo } | { ok: false } {
    const r = schema.safeParse(json);
    return r.success ? { ok: true, dados: r.data } : { ok: false };
}

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRADAS = 10_000;
const vistos = new Map<string, number>();

function limpar(agora: number) {
    for (const [id, em] of vistos) {
        if (agora - em > TTL_MS) vistos.delete(id);
        else break; // inseridos em ordem: o resto é mais novo
    }
    while (vistos.size > MAX_ENTRADAS) {
        const primeiro = vistos.keys().next().value;
        if (primeiro === undefined) break;
        vistos.delete(primeiro);
    }
}

export function jaEnviado(requestId: string, agora: number = Date.now()): boolean {
    limpar(agora);
    return vistos.has(requestId);
}

export function marcarEnviado(requestId: string, agora: number = Date.now()): void {
    vistos.set(requestId, agora);
    limpar(agora);
}

export function resetarEnviadosParaTeste(): void {
    vistos.clear();
}
```

- [ ] **Step 2: Testes da rota que falham** (`route.test.ts`, no estilo de `eventos/route.test.ts`): (a) sem `COMANDA_CODIGO_SECRET` → 503; (b) sem cabeçalhos / assinatura errada / timestamp fora da janela → 401 com o mesmo corpo `{ error: "Não autorizado" }`; (c) corpo fora do schema (telefone com 9 dígitos, código de 5, campo extra) → 422 e a resposta **não contém** o telefone nem o código; (d) caminho feliz → 200 `{ enviado: true }` e o provider falso recebeu `sendTemplate` com `name: "codigo_verificacao"`, `languageCode: "pt_BR"`, `bodyParameters: [codigo]`, `buttonParameters: [codigo]` e `jid` com `55` + telefone; (e) mesma `request_id` de novo → 200 `{ enviado: true, duplicate: true }` e o provider **não** é chamado de novo; (f) erro da Meta (`CloudApiError` de tipo `undeliverable`) → 422 sem vazar o número; (g) sem `WHATSAPP_CLOUD_SESSION_ID` ou sem provider pronto → 503; (h) nenhum `logger.*` recebe o telefone ou o código (espiar o logger e varrer os argumentos).

- [ ] **Step 3: Rodar** e ver falhar.

- [ ] **Step 4: Implementar a rota** (mesma ordem de checagens da rota de eventos: não configurado 503 → tamanho 413 → cabeçalhos 401 → assinatura 401 → schema 422 → idempotência → envio):
```ts
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getProvider } from "@/modules/whatsapp/provider";
import { CloudApiError } from "@/modules/whatsapp/cloud/errors";
import { parseTimestamp, timestampInWindow, verifyComandaSignature } from "@/modules/integracao/comanda/signature";
import { jaEnviado, marcarEnviado, validarPedidoCodigo } from "@/modules/integracao/comanda/codigo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;
const TAG = "ComandaCodigo";
const TEMPLATE = "codigo_verificacao";

/** Segredo de plataforma (rotação: lista separada por vírgula, mínimo de 16 caracteres cada). */
function loadCodigoSecrets(): string[] {
    return (process.env.COMANDA_CODIGO_SECRET ?? "")
        .split(",").map((s) => s.trim()).filter((s) => s.length >= 16);
}

export async function POST(request: NextRequest) {
    const secrets = loadCodigoSecrets();
    if (secrets.length === 0) {
        logger.error(TAG, "COMANDA_CODIGO_SECRET ausente ou inválida");
        return NextResponse.json({ error: "Integração não configurada" }, { status: 503 });
    }
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
        return NextResponse.json({ error: "Corpo grande demais" }, { status: 413 });
    }
    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Corpo grande demais" }, { status: 413 });

    const unauthorized = (reason: string) => {
        logger.warn(TAG, `recusado: ${reason}`);
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    };
    const timestampHeader = request.headers.get("x-saiae-timestamp");
    const signatureHeader = request.headers.get("x-saiae-signature");
    const ts = parseTimestamp(timestampHeader);
    if (ts === null || !signatureHeader) return unauthorized("cabeçalhos de autenticação ausentes ou inválidos");
    if (!timestampInWindow(ts)) return unauthorized("timestamp fora da janela de 5 minutos");
    if (!verifyComandaSignature(raw, timestampHeader!, signatureHeader, secrets)) return unauthorized("assinatura inválida");

    let json: unknown;
    try {
        json = JSON.parse(raw.toString("utf8"));
    } catch {
        return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }
    const pedido = validarPedidoCodigo(json);
    if (!pedido.ok) return NextResponse.json({ error: "Corpo fora do contrato" }, { status: 422 });
    const { telefone, codigo, request_id } = pedido.dados;
    if (request.headers.get("x-saiae-event-id") !== request_id) {
        return NextResponse.json({ error: "X-Saiae-Event-Id diferente do request_id" }, { status: 422 });
    }

    if (jaEnviado(request_id)) {
        logger.info(TAG, "pedido de código duplicado");
        return NextResponse.json({ enviado: true, duplicate: true });
    }

    const sessionId = process.env.WHATSAPP_CLOUD_SESSION_ID;
    const provider = sessionId ? getProvider(sessionId) : null;
    if (!provider || !provider.capabilities.templates || !provider.sendTemplate) {
        logger.error(TAG, "sessão Cloud API indisponível");
        return NextResponse.json({ error: "Envio indisponível" }, { status: 503 });
    }

    try {
        await provider.sendTemplate(`55${telefone}`, {
            name: TEMPLATE,
            languageCode: "pt_BR",
            bodyParameters: [codigo],
            buttonParameters: [codigo],
        });
    } catch (e) {
        if (e instanceof CloudApiError) {
            logger.warn(TAG, `Meta recusou o envio do código (${e.kind})`);
            const status = e.kind === "undeliverable" || e.kind === "template" || e.kind === "invalid_request" ? 422 : 502;
            return NextResponse.json({ error: "Envio recusado" }, { status });
        }
        logger.error(TAG, "falha inesperada ao enviar o código");
        return NextResponse.json({ error: "Falha ao enviar" }, { status: 502 });
    }

    marcarEnviado(request_id);
    logger.info(TAG, "código enviado");
    return NextResponse.json({ enviado: true });
}
```
Antes de colar, abrir `src/app/api/messages/[sessionId]/[jid]/template/route.ts` e a interface `WhatsAppProvider` e ajustar a **assinatura real** de `sendTemplate` (a rota de template mostra como ele é chamado: nome, idioma, `bodyParameters`) e o campo de tipo do erro (`CloudApiError.kind`); o teste (d) fixa o que o provider falso precisa receber.

- [ ] **Step 5: Liberar o caminho em `src/proxy.ts`** (rota pública, caminho **exato**, como a de eventos): replicar a entrada `"/api/integracao/comanda/v1/eventos"` com `"/api/integracao/comanda/v1/codigo-verificacao"`. Teste: o middleware não redireciona esse caminho para o login e continua redirecionando o resto.

- [ ] **Step 6: Rodar tudo:** testes novos e a suíte completa do CRM (`npm test`), lint e `tsc`. Expected: verde.

- [ ] **Step 7: Documentar** em `docs/INTEGRACAO_COMANDA_EVENTOS.md`: nova seção "Código de verificação", a env `COMANDA_CODIGO_SECRET` (Railway, mínimo 16 caracteres, lista para rotação), o nome do modelo (`codigo_verificacao`, categoria Autenticação, pt_BR, botão "copiar código") e os status de resposta.

- [ ] **Step 8: Commit e PR** — `git commit -m "feat(integracao): rota de envio do código de verificação da Comanda (modelo de autenticação)"`; PR com **nenhuma mudança de `schema.prisma`**. Depois do merge o dono precisa: criar e aprovar o modelo na Meta, definir `COMANDA_CODIGO_SECRET` na Railway e dar **Deploy**.

---

## Entregas que dependem do dono (não são código)
1. **Modelo na Meta:** criar `codigo_verificacao` (Autenticação, pt_BR, botão "copiar código", validade 5 min) e esperar a aprovação.
2. **Segredo:** definir `COMANDA_CODIGO_SECRET` na Railway (o mesmo valor entra como `CRM_CODIGO_SEGREDO` na Comanda; gerado e colado pelo dono, nunca no chat).
3. **Deploy** na Railway depois do merge.

## Self-review
- Spec Parte 2 (chamada Comanda → CRM, modelo de autenticação, CRM não guarda): Tasks 1 e 2. Idempotência por `request_id`: Task 2. Segredo de plataforma: Global Constraints.
- Sem schema, sem estado persistente: idempotência em memória, igual à rota de eventos (limite aceito: reinício permite repetir um código, o que só reenvia a mesma mensagem).
- Pontos que o executor confere nos arquivos reais (dito no texto, porque não foram lidos): assinatura exata de `sendTemplate`/`WhatsAppProvider`, campo `kind` de `CloudApiError`, formato da entrada pública em `src/proxy.ts`.
