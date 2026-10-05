# Sai aê 1.8 (versionCode 10) — subir no teste fechado

**Arquivo:** `android/app/release/saiae-1.8-vc10.aab` (assinado, 4,7 MB, pacote `com.aia.mesaagil`)

## Antes de subir (1 minuto)

1. Play Console > Sai aê > **Integridade do app** > Assinatura do app > **Certificado da chave de upload**.
   O SHA-1 tem que ser **`27:37:7F:A2:D6:4A:B2:A2:79:A1:C3:57:12:9C:0B:60:6B:CC:E8:FF`**.
   Se for outro, o Google recusa o arquivo ("assinado com a chave errada") — não suba, me avise.
2. Conferir que o versionCode **10** é maior que o da última versão enviada em qualquer trilha.

## Passo a passo

1. Play Console > **Testes e lançamento** > **Teste** > **Teste fechado** > trilha (ex.: "Alpha") > **Criar nova versão**.
2. **Enviar** `saiae-1.8-vc10.aab`. Esperar o processamento.
3. **Notas da versão** (cole abaixo, no idioma pt-BR).
4. **Salvar** > **Revisar versão** > **Iniciar lançamento no teste fechado**.
5. Em **Testadores**: confirmar a lista de e-mails (ou o Grupo do Google) da trilha e copiar o **link de participação** para enviar ao cliente.
6. O cliente abre o link, toca em "Tornar-se testador" e instala pela Play Store (sem precisar de conta interna).

## Notas da versão (pt-BR, cabe nos 500 caracteres)

```
<pt-BR>
Novidades da versão 1.8:
• Tipos de atendimento: Mesa, Balcão, Retirada e Entrega (ligue só o que usa em Ajustes).
• Entrega: dados do cliente, taxa de entrega, botão "Chamar entregador" pelo WhatsApp e clientes salvos.
• Comanda impressa com destaque de Retirada/Entrega.
• Correção da impressora Bluetooth em Android 7 a 11 e das fichas antigas que voltavam a imprimir.
• Relatórios separam Retirada e Entrega.
</pt-BR>
```

## O que pedir ao cliente para testar

- **Impressora (principal):** em Ajustes > Impressora, buscar e imprimir o teste; lançar um pedido e conferir se a comanda sai sozinha. Em Android 7 a 11 não deve pedir nenhuma permissão de Bluetooth; em Android 12+ pede "Dispositivos próximos" uma vez.
- **Fichas antigas:** abrir o app depois de um tempo desligado e confirmar que **não** imprime pedidos antigos sozinho.
- **Entrega:** lançar um pedido de Entrega (nome, telefone, endereço), conferir taxa e comanda, tocar em "Chamar entregador".
- Mandar print ou descrição de qualquer erro, com o modelo do celular e a versão do Android.

## Dados deste build

- versionCode 10 / versionName 1.8, minSdk 24 (Android 7), targetSdk 36.
- Supabase de produção: `vimjwzumjggrlvlxdejr` (conferido dentro do build).
- Gerado a partir da `main` com `vite build --mode novo` (o `.env.local` aponta para outro projeto e NÃO deve ser usado em build de release).
- Permissões de Bluetooth: `BLUETOOTH` e `BLUETOOTH_ADMIN` (até Android 11) e `BLUETOOTH_CONNECT` (Android 12+).
