# Fechamento dos avisos de WhatsApp (fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deixar os avisos de pedido pelo WhatsApp prontos para produção: qualquer loja com WhatsApp conectado recebe avisos sem configurar integração à parte, com validação ponta a ponta no staging.

**Architecture:** O trigger `_emitir_evento_saida` grava evento para loja com WhatsApp conectado; o worker `enviar-eventos-saida` assina com o segredo de plataforma (`destinoDePlataforma`); a rota `/eventos` do CRM aceita esse segredo para loja sem segredo próprio e registra o aviso para o worker Baileys.

**Tech Stack:** Supabase (Postgres, Edge Functions Deno), React/Vite, Next.js (CRM), Baileys.

**Spec:** `docs/superpowers/specs/2026-10-23-whatsapp-automacao-design.md` (fase 1 e ordem de entrega: avisos, depois bot, depois disparos).

## Global Constraints

- Sem merge nem deploy em produção sem OK explícito do João. Ordem de produção: CRM → migrations → secrets → functions → app.
- Segredos nunca em chat nem em campos digitados por agente.
- Commitar só arquivos da própria mudança (há alterações de outra sessão no working tree).

## Review Focus

- Loja com integração própria continua usando o segredo próprio (não o de plataforma).
- Loja sem WhatsApp conectado não gera evento.
- Cliente em opt-out (SAIR) não recebe aviso.
- Banner de erro não pisca com uma falha isolada do CRM.

---

### Task 1: Eventos para loja só com WhatsApp (feito)
Migration `20261030130000`, worker, `destinoDePlataforma`, rota `/eventos` do CRM. Commits `ac90144` (app) e `cff3bcd` (CRM). Testes: app 1596, CRM 191.

### Task 2: Validação ponta a ponta na loja `jmal` (staging)
- [ ] Eventos pendentes da `jmal` passam a `entregue` após o deploy do CRM (consulta em `eventos_saida`).
- [ ] `whatsapp_avisos_log` do CRM mostra o aviso `recebido` enviado (script `hist.mjs` com o id da `jmal`).

### Task 3: Banner de erro só após 2 falhas seguidas
**Files:** `src/components/SecaoWhatsappAutomacao.tsx`, teste em `tests/`.
- [ ] Teste: uma falha isolada do histórico não mostra "Não foi possível falar com o WhatsApp agora"; a segunda seguida mostra.
- [ ] Implementar contador de falhas consecutivas zerado a cada sucesso.

### Task 4: Documentação e deploy de produção
**Files:** `docs/roteiro-whatsapp-avisos.md`
- [ ] Ordem de deploy inclui migration `20261030130000`, function `enviar-eventos-saida` e rota `/eventos` com segredo de plataforma.
- [ ] Nota LGPD: loja com WhatsApp conectado envia ao CRM os eventos `order.*` com telefone, nome e itens.

### Fora deste plano (precisa de spec própria)
Fase 2 (bot que anota pedido, `integracao-v1`, Pix) e disparos: o spec lista decisões abertas (pagamento do bot, destino da avaliação). Passos 11 e 13 do roteiro exigem login de outra conta (feitos pelo João).
