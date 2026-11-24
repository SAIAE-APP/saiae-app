# NFC-e: automação e pacote do contador — plano (rascunho para revisão)

Estado: **PROPOSTA. Nada implementado.** Complementa `2026-10-12-nfce-automatica-e-lote-design.md` (emissão automática e em lote, PRs 1–7 lá descritos), que continua válido.

## 1. Problema

O módulo fiscal é cobrado à parte (R$ 69,90/mês por CNPJ). O valor percebido tem de ser: "o contador recebe tudo pronto sem eu fazer nada". Hoje:

- A nota só sai **manualmente, um pedido por vez**, pelo botão do card no Histórico (`BotaoEmitirNota` → `emitir-nfce`). Ligar fiscal e homologação **não** emite sozinho no primeiro pedido.
- O **suporte não emite** nota por cliente: não está em `usuarios_barracas` (por desenho do "Acesso do suporte").
- **Não existe** nenhuma forma de juntar as notas do mês e entregar ao contador (nem XML, nem relatório, nem e-mail). A nota guarda só chave, número, série, protocolo e `qrcode_url` em `pedidos`; o XML fica na SEFAZ e na FocusNFe.

## 2. Fato externo verificado (doc FocusNFe, lida em 2026-11-24)

`GET /v2/backups/{cnpj}.json` (produção `https://api.focusnfe.com.br/v2`, homologação `https://homologacao.focusnfe.com.br/v2`), Basic Auth com o token da barraca (o mesmo de `barracas_fiscal_token`).
- Sem parâmetro de mês: devolve lista `[{mes: "AAAAMM", xmls: <url zip>, danfes: <url zip, só NFe>}]`.
- `xmls.zip` inclui NFC-e. Backup mensal fechado no dia 1; parcial todo sábado; recomendado baixar a partir do dia 2.
- Retenção na FocusNFe: no mínimo 6 meses. XML tem de ser guardado 5 anos pelo emitente.
- A doc avisa que o backup pode não conter todas as notas. **Não verificado:** se homologação gera backup real; se as URLs do S3 são públicas ou expiram; limite de taxa. Confirmar com suporte da FocusNFe antes de depender.

## 3. Objetivo

1. Nota emitida **sozinha** quando o pedido é entregue (opção, padrão desligada), sem o suporte emitir nada.
2. **Pacote do contador** mensal: ZIP de XMLs + planilha de conferência, gerado sem trabalho manual e entregue ao contador.
3. Painel do suporte (superadmin) para ver, por cliente, se o mês está completo, sem emitir nota por ele.

Fora de escopo: cancelamento/inutilização, NF-e, contingência offline, CPF por pedido na automática.

## 4. Parte A — emissão automática e em lote

Executar o spec de 2026-10-12 como está (fila `nfce_fila`, trigger, worker `processar-fila-nfce`, lote no Histórico). Decisões do dono pendentes lá (seção 14 do spec): atraso, idade máxima, quem pode, falha de dados fiscais, piloto. **Pré-requisito do spec (seção 0):** uma nota real de ponta a ponta com campos conferidos. O dono emitiu uma nota; falta registrar em qual ambiente e conferir `serie`, `protocolo`, `qrcode_url`.

## 5. Parte B — pacote do contador (novo)

### 5.1 Dados

- Tabela `fiscal_contador` (uma linha por barraca): `barraca_id` (PK), `email_contador` (texto validado), `email_copia_dono` boolean, `envio_automatico` boolean (padrão false), `ultimo_envio_mes` (AAAAMM). RLS: só dono lê/escreve; suporte sem acesso.
- Tabela `fiscal_pacotes` (histórico): `barraca_id`, `mes` AAAAMM, `gerado_em`, `qtd_autorizadas`, `qtd_canceladas`, `qtd_erro_ou_pendentes`, `valor_total_centavos`, `storage_path` do ZIP, `enviado_em`, `enviado_para`. Guarda cópia do ZIP no Storage do Supabase (a FocusNFe só retém 6 meses e a lei pede 5 anos).

### 5.2 Edge function `gerar-pacote-contador`

Entrada: `barraca_id`, `mes`. Passos:
1. Autoriza dono (ou o job com segredo). Lê token do ambiente da barraca e CNPJ.
2. Chama `GET /backups/{cnpj}.json`, acha o item `mes`, baixa `xmls.zip` (server-side).
3. Monta `conferencia.csv` a partir de `pedidos` do mês (por `nfce_emitida_em`, ambiente produção): data, número, série, chave, valor, forma de pagamento, CPF se houver, status. Lista à parte pedidos **sem nota** e com **erro**, para o contador/dono saberem o que falta.
4. Compara chaves do CSV com as chaves dentro do ZIP; qualquer diferença vira linha de "divergência" (o backup pode estar incompleto).
5. Empacota `xmls.zip` + `conferencia.csv` + `LEIAME.txt` num único ZIP, grava no Storage, registra em `fiscal_pacotes`.
6. Ignora notas de homologação em qualquer pacote de produção.

### 5.3 Entrega

- **Tela** (Ajustes > Fiscal > Contador, só dono): campo do e-mail do contador, botão "Gerar pacote do mês" e lista de pacotes com download (link assinado com expiração curta).
- **Automática** (opcional): `pg_cron` no dia 2 de cada mês chama a função para cada barraca com `envio_automatico`. Envia o e-mail ao contador (e cópia ao dono) com **link assinado** para o ZIP, nunca o ZIP anexado nem URL pública. Mês com divergência ou pedido sem nota: envia mesmo assim, com aviso no corpo, e avisa o dono no app.
- Provedor de e-mail: **a decidir** (o repo ainda não tem envio de e-mail transacional confirmado; verificar antes). Alternativa sem provedor novo: só a tela + link para o dono encaminhar.

### 5.4 Painel do suporte (superadmin)

Nova aba no `/admin`: por barraca com módulo fiscal, mês corrente e anterior: notas autorizadas, pendentes, com erro, pacote gerado/enviado. Só leitura; **sem emitir nota** (preserva a regra de que suporte não emite). Ações permitidas: "Gerar pacote" (não altera notas). Registrar no log de ações do admin.

### 5.5 Segurança e privacidade

- Link assinado, expiração curta, bucket privado; e-mail do contador é dado pessoal: só o dono edita; log sem conteúdo de XML.
- O XML contém CNPJ/CPF e itens: não passar por serviço de terceiros além do provedor de e-mail (que só carrega o link).
- Token fiscal lido por helper único (alinhado ao #180), nunca em log.
- RPCs e tabelas: RLS, `revoke ... from public, anon`, papel `dono` explícito.

## 6. Ordem de entrega (PRs pequenos)

0. Pré-requisito: nota real conferida; confirmar com FocusNFe (homologação, URLs, limite).
1. Parte A PR 1–2 (núcleo, guardas, fila).
2. Parte B PR B1: migrations `fiscal_contador` e `fiscal_pacotes`, bucket privado, RLS, testes PGlite.
3. B2: `gerar-pacote-contador` com FocusNFe simulada; testes (divergência, homologação ignorada, mês sem backup).
4. B3: tela Ajustes > Fiscal > Contador (gerar, listar, baixar).
5. Parte A PR 3–6 (worker, Ajustes, Histórico, lote).
6. B4: envio mensal automático (cron + e-mail), só depois de escolher provedor.
7. B5: aba do suporte.
8. Roteiro de teste em `docs/` e atualização do `CLAUDE.md`.

Tudo nasce desligado; produção só com ordem do dono e uma barraca piloto.

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Backup da FocusNFe incompleto ou atrasado | Conferência por chave, aviso de divergência, gerar só a partir do dia 2, regerar no sábado |
| Retenção de 6 meses da FocusNFe < 5 anos legais | Guardar cópia no Storage (5.1) |
| Vazamento de XML por link | Bucket privado, link assinado curto, e-mail só com link |
| E-mail do contador errado | Confirmação ao salvar e envio de teste |
| Nota de homologação entrar no pacote | Filtro por `nfce_ambiente = 'producao'` |
| Custo por nota (FocusNFe cobra por nota) | Avisos do spec de 2026-10-12 seção 6 |

## 8. Perguntas ao dono

1. Provedor de e-mail: usar um já contratado ou entregar só por link na tela?
2. O contador aceita ZIP de XML + CSV, ou exige algum formato específico (ex.: pasta por mês, SPED)?
3. Envio automático no dia 2 está bom, ou o contador quer outro dia?
4. O suporte deve poder gerar o pacote pelo cliente?

## 9. Revisão (Codex, 2026-11-24) e decisões do dono

Codex revisou o plano; cada achado foi conferido no código antes de aceitar.

**Aceitos (mudam o plano):**
- **Guarda legal do XML (alta).** Não depender só do backup da FocusNFe (mínimo 6 meses). Gravar o XML autorizado (e o de cancelamento, se houver) no Storage privado **na própria emissão**, com verificação de integridade. O backup mensal vira só reconciliação. Definir o que acontece com o acervo na exclusão de conta (`excluir_dados_conta` apaga pedidos).
- **Mês fiscal do CSV (alta).** `nfce_emitida_em` é a hora em que o app gravou, e `data_emissao` enviada à FocusNFe é `new Date()` da chamada (handler.ts ~486). Usar `dhEmi` e `vNF` do XML autorizado para fechar o mês. Vendas sem nota apuradas pela data do pedido, no fuso da barraca, com motivo (rejeitada, pendente, inelegível).
- **ZIP só com o que é nosso (alta).** Não repassar o `xmls.zip` da FocusNFe cru: ele é por CNPJ e pode ter notas de outros sistemas. Montar o ZIP só com XMLs validados (modelo 65, `tpAmb` produção, competência), chaves extras listadas à parte.
- **Ambiente fixado (alta).** Pacote só com notas `nfce_ambiente = 'producao'`; registros antigos com ambiente nulo não são inferidos pelo ambiente atual.
- **Segurança da entrega (alta).** Validar papel de dono em cada operação da função; caminho do objeto derivado no servidor; teste de isolamento entre barracas em `storage.objects`; remover CPF do CSV; e-mail só com link; suporte só com métricas agregadas no piloto.
- **Cron (alta).** Controlar geração e envio por barraca, competência, versão e destinatário, com idempotência, retentativa e reenvio quando o mês for corrigido. Distinguir mês sem movimento de backup indisponível.
- **Provedor (média).** Resend já está integrado (`trial-avisos`); validar para envio fiscal. B1–B4 podem pilotar com notas manuais sem esperar a fila; aba do suporte (B5) vai depois do piloto.

**Rejeitados ou corrigidos:**
- "PR 1 recusar cancelado no servidor": já existe (handler.ts:190). Retirar do PR 1.
- Reconciliação tratar falha de consulta como ausência: o código já documenta que a FocusNFe recusa `ref` repetida e a recusa é reconsultada antes de virar erro. Risco menor que o apontado, mas manter teste explícito (timeout/429/5xx seguido de POST).

**Ponto legal em aberto (alta) — decidir com o contador antes do piloto:** o Codex aponta que, em geral, a NFC-e deve ser emitida no momento da venda/antes da saída da mercadoria, e que emitir só em `entregue`, com atraso ou em lote retroativo pode ser irregular conforme a UF. Não verificado por mim. Lote retroativo em produção fica bloqueado até o contador validar.

## 10. Pedidos novos do dono (2026-11-24)

**Emissão automática com o módulo fiscal.** Com o módulo ativo, toda venda emite a nota sozinha, **imediatamente ao entregar**, e o cupom sai com a nota. Sem interruptor por barraca (o módulo ativo é o interruptor); `NFCE_FILA_ATIVA=0` segue como pausa de emergência. Sem atraso, a forma de pagamento deixa de ser corrigível depois da nota: aceito pelo dono. Depende dos PRs da fila (Parte A) e do aval do contador sobre o momento da emissão.

**Baixar a nota emitida para enviar ao cliente.** FocusNFe (doc lida 2026-11-24): a consulta `GET /v2/nfce/{ref}` devolve `caminho_xml_nota_fiscal` (XML) e `caminho_danfe` (DANFCe **em .html**, não PDF). Não há endpoint de PDF na API de nuvem. Existe a operação **"enviar por e-mail"** de NFC-e. O dono quer PDF + XML.
- Botão "Baixar nota" no card (Histórico): função `baixar-nota-fiscal` (dono da barraca; lê o token no servidor), baixa o XML e o DANFCe da FocusNFe, converte o DANFCe em PDF no servidor e devolve XML e PDF.
- Não verificado: se os arquivos de `caminho_*` exigem Basic Auth; conteúdo e redirecionamentos do `.html`; formato e limites do e-mail de NFC-e da FocusNFe. Testar numa nota de homologação antes de implementar.
- Alternativa se o PDF der trabalho: enviar a nota ao cliente pela operação de e-mail da FocusNFe e oferecer o XML para baixar.
