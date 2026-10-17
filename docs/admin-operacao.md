# Painel do superadmin: como colocar no ar e operar

Complementa `roadmap-admin-e-observabilidade.md` (a especificação). Aqui está o que foi construído e o que o dono do produto ainda precisa fazer à mão.

## O que existe

| Funcionalidade | Migration | App / função |
|---|---|---|
| 1. Planos e prazos | `20261028100000_admin_planos_prazos.sql` | `/admin` (lista, filtros, paginação) |
| 2. Ativas agora | `20261028110000_admin_resumo_ativas.sql` | cartões e gráfico em `/admin` |
| 4. Observabilidade | `20261028120000_observabilidade.sql` | `src/lib/erroApp.ts`, `GuardaErroApp`, alertas e saúde em `/admin`, função `alertas-admin` |
| 5. Ciclo do trial | `20261028130000_trial_avisos.sql` | função `trial-avisos` |
| 3. Abrir loja (leitura) | `20261028140000_admin_abrir_barraca.sql` | `/admin/barraca/:id`, seção "Acessos do painel Sai aê" em Ajustes › Conta |
| 6. Continuidade | (sem migration) | Política de Privacidade atualizada; checklist abaixo |

Ordem de entrada: **migrations (na ordem do nome) → edge functions → app**. Tudo é aditivo.

### Sobre a abertura da loja (funcionalidade 3)
- É uma tela própria de leitura (Histórico, Cozinha, Faturamento, Caixa, Ajustes), não as telas do dono reaproveitadas. O motivo: as telas do dono gravam em dezenas de lugares; uma tela separada alimentada só por funções `SELECT` torna a leitura somente-leitura por construção, sem tocar em `usuario_tem_acesso_barraca` nem em policy nenhuma.
- O superadmin **não** ganha linha em `usuarios_barracas`. Gravar direto em `pedidos`, `caixas` ou `barracas` falha por RLS (testado em `tests/adminAbrirBarracaMigration.test.ts`).
- Telefone mascarado nos 4 últimos dígitos, só o primeiro nome; endereço só aparece em "Mostrar dados completos" (um pedido por vez, gravado em `acessos_admin_revelacoes`). Sem exportação.
- Edição do cardápio: o superadmin entra em `usuarios_suporte` (gatilho) e resgata o código de 8 caracteres do dono, igual ao suporte.

## Primeira vez em cada ambiente

1. Aplique as migrations (staging primeiro).
2. Inclua o superadmin (uma vez; o gatilho também o coloca em `usuarios_suporte`):
   ```sql
   insert into public.superadmins (usuario_id)
   select id from auth.users where email = 'contatosaiae@gmail.com';
   ```
3. Entre no app com essa conta e abra `/admin`.

## Alertas e avisos de trial por e-mail (dormentes até configurar)

As duas funções existem e estão testadas, mas **só funcionam depois destes passos** (nada disso foi feito em produção):

1. Secrets (use `--project-ref` explícito):
   ```
   supabase secrets set --project-ref <ref> RESEND_API_KEY=<...> ALERTAS_ADMIN_EMAIL_DESTINO=<seu e-mail> ALERTAS_ADMIN_SEGREDO=<aleatório> TRIAL_AVISOS_SEGREDO=<aleatório>
   ```
2. Deploy:
   ```
   supabase functions deploy alertas-admin --no-verify-jwt --project-ref <ref>
   supabase functions deploy trial-avisos --no-verify-jwt --project-ref <ref>
   ```
3. Agendamento (mesmo padrão de `disparar_worker_eventos`: `pg_cron` + `pg_net`). Exemplo, trocando `<ref>` e o segredo:
   ```sql
   select cron.schedule('alertas-admin', '*/15 * * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/alertas-admin',
       headers := jsonb_build_object('Authorization', 'Bearer <ALERTAS_ADMIN_SEGREDO>'),
       body := '{}'::jsonb) $$);
   select cron.schedule('trial-avisos', '0 * * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/trial-avisos',
       headers := jsonb_build_object('Authorization', 'Bearer <TRIAL_AVISOS_SEGREDO>'),
       body := '{}'::jsonb) $$);
   ```
4. **Antes de ligar o `trial-avisos` em produção:** a primeira rodada manda e-mail para todo dono cujo trial cai nas janelas (acaba em até 7 dias, acabou há menos de 14 dias, ou sem pedido). Rode `select * from public.trial_avisos_pendentes();` como administrador e confira quem vai receber.

Regras dos alertas (constantes dentro de `alertas_sistema()`): barraca que vendia em 5 dos 7 dias e ficou 3 dias sem pedido; 10 erros da mesma versão do app em 1 hora; 3 falhas de webhook da Stripe em 24 h. Falha de Pix pelo Mercado Pago ainda não entra: `webhook-mercadopago` não grava evento com erro.

## Versão do app por barraca
`vite.config.ts` define `__APP_VERSION__` com `VITE_APP_VERSION` (se existir) ou o commit atual. Para o painel distinguir builds do Android, defina `VITE_APP_VERSION` no build de release (por exemplo `2.3`, o `versionName`). Sem isso, mostra o hash do commit. Erros sem barraca (antes do login) são descartados de propósito: a tabela exige barraca.

## Continuidade e segurança (funcionalidade 6): checklist do dono
Nada disso dá para fazer por código; confira e marque.

- [ ] **Backup do Supabase:** Dashboard › Database › Backups, no projeto `Sai aê` (`vimjwzumjggrlvlxdejr`). Confirme que existe backup diário no plano contratado (o plano gratuito não tem; considere Pro ou um `pg_dump` agendado).
- [ ] **Teste de restauração:** restaurar um backup (ou um `pg_dump`) no `Sai ae staging` e abrir o app apontando para ele. Só dá para confiar em backup que já foi restaurado.
- [ ] **Chave de upload da Play (`mesaagil-upload.jks`) e senhas:** guardar em pelo menos dois lugares fora deste PC (gerenciador de senhas e cópia criptografada na nuvem). Sem a chave só se atualiza o app pedindo reset de chave de upload ao Google. *Não encontrei o `.jks` dentro de `D:\Projetos`, `D:\escritorio` nem `C:\Users\AORUS` (busca de 4 níveis); procure onde ele está de fato.*
- [ ] **Segredos soltos:** a varredura do repositório `saiae-app` (chaves `sk_live`, `service_role`, chave privada PEM, `*.jks`, `key.properties`) não achou nada versionado. Os `.env*` reais são ignorados pelo git (`.env.local`, `.env.staging.local`). Falta olhar as outras pastas em `D:\Projetos` e o disco por arquivos de texto com tokens (a varredura foi só deste repo).
- [x] **Política de Privacidade:** atualizada (seções 6, 11 e 12) citando o registro de erros, o acesso da equipe, o log de acesso e a retenção de 30 dias.

## Avisos sobre o staging
- O staging está **atrás da produção**: faltam as migrations de `20261022130000_trial_plano_essencial` até `20261027100000_tokens_cifrados_colunas` (inclui `acesso_suporte`, então `usuarios_suporte` não existe lá). Por isso o gatilho `superadmin_vira_suporte` (final da migration 3) **não foi aplicado no staging** e só foi testado no PGlite.
- As migrations deste painel foram aplicadas no staging pelo conector do Supabase (em partes), então o histórico de versões lá tem carimbos de data diferentes dos nomes dos arquivos. Rode `npm run staging:repair` antes do próximo `staging:push`.
- Existe uma conta com e-mail real (`contatosaiae@gmail.com`) no staging, o que faz o `npm run staging:seed` abortar (regra "só e-mail `.invalid`"). Apague essa conta do staging antes de re-semear, ou use outro ambiente para testar o `/admin`.
