# Spike Mercado Pago marketplace (descartável)

Prova, no sandbox, que `application_fee` de R$ 0,99 funciona em Pix e cartão com o token OAuth do vendedor de teste.
Use somente contas de teste. Não rode com credenciais de produção.

## Configuração: `.env.spike` na raiz (já está no .gitignore)

```
MP_SPIKE_SANDBOX=sim            # confirma que só há credenciais de TESTE
MP_CLIENT_ID=                   # aplicação do marketplace
MP_CLIENT_SECRET=
MP_REDIRECT_URI=                # igual a "URLs de redirecionamento" da aplicação
MP_PUBLIC_KEY=                  # chave pública da aplicação do marketplace (tokenização do cartão)
MP_PAYER_EMAIL=                 # opcional
# gravados pelo comando "trocar": MP_SELLER_ACCESS_TOKEN, MP_SELLER_REFRESH_TOKEN
```

## Ordem

1. `node scripts/spike-mp-marketplace.mjs auth-url` e abrir a URL logado na conta VENDEDORA de teste.
2. Copiar o `code` da URL de retorno: `node scripts/spike-mp-marketplace.mjs trocar <code>`.
3. `pix`, `cartao`, `cartao-recusado` (nome do titular OTHE).
4. `estorno <payment_id>` com um id impresso acima.

Cada comando termina com o bloco `RESULTADO`, para copiar na seção "Resultado do spike" do spec.

## Não confirmado nas docs (conferir no sandbox)

- Formato de `POST /v1/card_tokens?public_key=`: usado o corpo padrão do tokenizador do SDK JS; as docs consultadas não o mostram. Se falhar, gerar o token pelo SDK MercadoPago.js.
- Caminho da comissão na resposta: as docs não dizem; o script varre a resposta atrás de chaves e tipos com "fee".
- Se o estorno devolve a comissão: a API só retorna o status do estorno; confira o saldo no painel.
- Se `test_token: 'true'` é necessário para contas de teste: as docs dizem que gera credenciais de sandbox; o script envia sempre.
- O cartão usa `payment_method_id` `master` (Mastercard de teste); ajuste se o sandbox pedir outro.
- A página de OAuth específica de marketplace (split-payments) retornou 404; a URL e o `/oauth/token` vêm da página de OAuth do Checkout API.
