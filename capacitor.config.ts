import type { CapacitorConfig } from '@capacitor/cli'

// App nativo Android que embrulha o mesmo build web (dist/) já usado no
// Cloudflare Pages — não aponta pra uma URL remota (webDir local, servido
// pelo próprio app), pra manter a mesma garantia de "funciona offline" que
// o PWA já tem: só as chamadas ao Supabase (auth/dados) dependem de rede,
// nunca o carregamento do app em si.
const config: CapacitorConfig = {
  // appId não muda no rebrand: já foi enviado ao Google Play vinculado a
  // este pacote — trocar aqui criaria um app novo na loja, não uma
  // atualização do existente.
  appId: 'com.aia.mesaagil',
  appName: 'Sai aê',
  webDir: 'dist',
  // iOS: WebView sob o notch/barra home; o CSS respeita env(safe-area-inset-*)
  // (exige viewport-fit=cover no index.html). Mesma base do Android.
  ios: {
    contentInset: 'never',
    backgroundColor: '#FFFFFF',
  },
}

export default config
