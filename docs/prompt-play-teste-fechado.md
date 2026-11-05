# Prompt para a extensão: subir o .aab no Teste fechado (Play Console)

Cole o texto abaixo na extensão (Claude in Chrome), com o Play Console aberto e logado.

---
Você tem autorização total para executar este fluxo até o fim, sem pedir confirmação a cada passo.

Objetivo: publicar o arquivo `saiae-2.5-vc19.aab` (versionName 2.5, versionCode 19) do app "Sai aê" (pacote `com.aia.mesaagil`) na faixa de **TESTE FECHADO**. NUNCA use Teste interno, Teste aberto nem Produção.

Passos:
1. Play Console > app "Sai aê" > Testes > **Teste fechado**. Abra a faixa que já está em uso (a do teste fechado atual). Se houver mais de uma, use a que tem testadores ativos.
2. Clique em "Criar nova versão".
3. Em "Pacotes de apps", envie `saiae-2.5-vc19.aab` (pasta `D:\Projetos\mesaagil\android\app\release`). Se pedir, mantenha a assinatura do app pelo Google Play.
4. Nome da versão: `2.5 (19)`.
5. Notas da versão (pt-BR), em `<pt-BR>`:
   Novo filtro por vários produtos e categorias no faturamento e no histórico, cabeçalho do histórico que encolhe ao rolar e melhorias de estabilidade.
6. Clique em "Salvar", depois "Revisar versão". Se houver AVISOS, siga em frente; se houver ERROS (por exemplo versionCode repetido ou assinatura inválida), pare e me diga o texto exato do erro.
7. Clique em "Iniciar lançamento para Teste fechado" e confirme.
8. Confirme na tela de Visão geral que a versão 19 aparece como "Em análise" ou "Disponível" no Teste fechado.

Regras:
- Não altere lista de testadores, ficha da loja, política de privacidade nem declarações.
- Não digite senhas nem códigos de verificação: se o login ou a verificação em duas etapas aparecer, pare e me avise.
- No fim, responda só com: faixa usada, versão enviada, status mostrado e qualquer erro ou aviso.
---
