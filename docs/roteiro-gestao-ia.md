# Roteiro de teste: Gestão por IA (MCP)

Spec: `docs/superpowers/specs/2026-11-27-mcp-gestao-ia-design.md`. Fazer só no STAGING, com uma barraca de teste.
Nada abaixo foi validado em banco, Storage ou cliente de IA reais.

## 1. Preparação
1. Aplicar as migrations em ordem: `20261127100000`, `20261127110000`, `20261128100000`, `20261128110000`, `20261129100000`.
2. Publicar a function: `supabase functions deploy mcp-saiae --no-verify-jwt`. Ela exige a `20261129100000` já aplicada.
3. Publicar o app.
4. No painel de admin, ativar o módulo `ia_gestao` (cortesia) para a barraca de teste.
5. Em Ajustes > Conta > Gestão por IA, criar uma chave (aparece uma vez) e copiar o endereço do conector.

## 2. Conexão
- [ ] ChatGPT: conector personalizado com o endereço e a chave como Bearer. Verificar se aceita token fixo; se não aceitar, o plano B é OAuth (não implementado).
- [ ] Claude: mesmo teste.
- [ ] A lista de ferramentas aparece e as de escrita pedem aprovação do cliente de IA.

## 3. Segurança (devem falhar)
- [ ] Sem módulo `ia_gestao`: 403 `modulo_desligado`.
- [ ] Chave revogada: 401.
- [ ] Mais de 60 chamadas em 1 minuto: 429.
- [ ] Item de outra barraca: "não encontrado".
- [ ] `definir_foto_item` com `http://`, IP interno, `localhost`, redirect para IP interno e arquivo acima de 5 MB: recusado.
- [ ] Sem a aprovação do dono, aplicar devolve "aguardando aprovação".

## 4. Fluxos (cada um: IA propõe, dono aprova em Ajustes, IA aplica)
- [ ] `alterar_preco_item`: aplicar muda o preço; preço mudado entre proposta e aplicar recusa.
- [ ] `marcar_esgotado` e voltar a vender.
- [ ] `ajustar_estoque`: +5, -2, item sem controle liga o controle.
- [ ] `resumo_vendas_dia`: bate com o Faturamento do dia.
- [ ] `criar_cupom`: nasce pausado; ativar manualmente em Ajustes.
- [ ] `definir_foto_item`: foto aparece no item; a antiga some do Storage.
- [ ] `importar_cardapio_de_foto`: foto de cardápio de papel, conferir a prévia, aprovar, repetir (não duplica).
- [ ] Recusar e deixar vencer (15 min): aplicar responde recusada/expirada.
- [ ] Histórico "Últimas ações da IA" mostra tudo.

## 5. Concorrência (manual)
- [ ] Aplicar a mesma proposta duas vezes ao mesmo tempo: uma aplica, a outra devolve `ja_aplicada`.
- [ ] Revogar a chave durante a aplicação.

## 6. Depois
- Agendar a purga `mcp_auditoria_purgar(90)` (Integrations > Cron ou `pg_cron`).
- Definir o preço do módulo `ia_gestao` (hoje 0, escondido no painel).
- Política de Privacidade: citar que a IA externa lê dados da barraca.
- Limites conhecidos: DNS rebinding residual, foto sem redimensionar, sem unicidade de nome em itens (ver spec).
