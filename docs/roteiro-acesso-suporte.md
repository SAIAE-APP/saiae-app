# Roteiro de teste: Acesso do suporte

Pré-requisito: migration `20261023100000_acesso_suporte` aplicada; o id da conta de suporte (ex.: a do dono do
projeto) incluído manualmente em `usuarios_suporte` por SQL (`insert into usuarios_suporte (usuario_id) values ('<uuid>')`
— a allowlist nasce vazia, ninguém resgata nada sem isso).

1. **Gerar código (dono)**: em Ajustes > Conta > "Acesso do suporte", toque "Gerar código de suporte". Aparece um
   código de 8 caracteres (sem 0/O/1/I) e "válido até ..., uso único".
2. **Conta fora da allowlist**: com outra conta (não cadastrada em `usuarios_suporte`), em Selecionar barraca >
   "Tenho um código de suporte", digite o código gerado no passo 1. Deve dar "Código inválido ou expirado." —
   mesma mensagem de um código errado, nunca revela que a conta não está na lista.
3. **Resgate com sucesso**: com a conta de suporte (na allowlist), digite o mesmo código. Deve entrar direto na
   loja do dono.
4. **Código de uso único**: tente digitar o MESMO código de novo (outra conta de suporte, ou a mesma depois de
   sair/entrar). Deve recusar.
5. **PIN pulado, mas o acesso de verdade é só cardápio**: com o acesso de suporte ativo, abra Ajustes — não
   deve pedir o PIN. Em Ajustes > Cardápio & Operação, consegue ver e editar itens/categorias (criar, editar,
   apagar). Histórico, Caixa, Faturamento e as demais seções de Ajustes (Identidade, Pagamento, Fiscal,
   Pagamento online, Impressora) ficam **vazios ou com erro de carregamento** — é esperado (a RLS do banco só
   libera cardápio pro suporte; o PIN pulado é só a tela, não dá acesso a mais nada).
6. **Faixas fixas**: na conta de suporte, uma faixa fixa mostra "Você está como SUPORTE nesta loja até DD/MM"
   em qualquer tela da loja. Na conta do dono, aparece "Suporte com acesso até DD/MM [Encerrar]".
7. **Limites de suporte**: ainda na conta de suporte, confirme que NÃO é possível: apagar a loja (a opção nem
   aparece — fica só na tela de Selecionar barraca pro dono); excluir a conta do dono; trocar o token de
   pagamento, o segredo do webhook do CRM, o token fiscal ou o PIN administrativo (essas telas nem carregam,
   RLS bloqueia); apagar pedidos ("Apagar período" em Histórico nem carrega os pedidos pro suporte).
8. **Encerrar pelo dono**: toque "Encerrar" na faixa fixa (ou "Encerrar acesso agora" em Ajustes > Acesso do
   suporte). O acesso para na hora: reabrir Ajustes na conta de suporte volta a pedir o PIN, e a barraca some da
   lista de "Selecionar barraca" dessa conta.
9. **Expiração natural**: um código não resgatado em 24h, ou um acesso resgatado há mais de 7 dias, para de
   funcionar sozinho (sem precisar de "Encerrar") — conferir só a lógica no teste de banco
   (`tests/acessoSuporteMigration.test.ts`), não dá pra esperar 7 dias de verdade neste roteiro.
10. **Limite de tentativas**: digite um código errado 5 vezes seguidas (conta de suporte, na allowlist). Na 6ª
    tentativa — mesmo com o código certo — deve recusar como "bloqueado"; espere alguns minutos e tente de novo.
11. **360px e 768px**: confira os três pontos de tela acima (Ajustes > Acesso do suporte, Selecionar barraca com
    "Tenho um código de suporte", as duas faixas fixas) em 360px e 768px — nada deve quebrar linha nem sobrepor.
