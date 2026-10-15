# Sai aê no iPhone (build híbrido)

Mesma base de código do Android: o app web (`dist/`) embrulhado pelo Capacitor.
`appId` = `com.aia.mesaagil` (igual ao Android).

## Como compilar (precisa de Mac com Xcode 16+)
```bash
npm install          # aplica os patches
npm run build        # gera dist/
npx cap sync ios     # copia dist/ e resolve plugins (Swift Package Manager)
npx cap open ios     # abre no Xcode
```
No Xcode: escolher o Team, conferir Bundle Identifier, subir `CURRENT_PROJECT_VERSION`
a cada envio e fazer Product > Archive > TestFlight.

## O que muda no iPhone
- `viewport-fit=cover` + `env(safe-area-inset-*)` (já usado nas telas) respeitam notch e barra home.
- Impressora térmica: só Android (Bluetooth SPP). `impressoraSuportada()` já esconde no iOS.
- Biometria usa WebAuthn; dentro do WKWebView pode não estar disponível, e aí o recurso some sozinho.
- Orientação: só retrato no iPhone.

## Pontos a validar em aparelho (nada disso foi testado, o desenvolvimento foi em Windows)
1. O plugin `@devlas/capacitor-thermal-printer` tem Package.swift pra iOS: confirmar que compila.
2. Teclado cobrindo campos nos formulários de Confirmar Pedido e Entrega.
3. Barra inferior e cabeçalhos com notch (iPhone com Dynamic Island e iPhone SE).
4. Toast e rolagem elástica.
