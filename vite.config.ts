import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // O manifest é dinâmico por barraca (functions/[slug]/manifest.webmanifest.ts),
      // não um manifest.webmanifest estático — o plugin só cuida do service worker.
      manifest: false,
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,ttf}'],
        // exceljs só carrega sob demanda (import dinâmico no botão Exportar
        // de Histórico) — é ~1MB, não vale precachear pra todo mundo que
        // nunca exporta nada
        // saiae-og.png só é usado por crawlers de link preview (WhatsApp,
        // redes sociais) — o app em si nunca carrega essa imagem, não vale
        // precachear pra instalação do PWA
        globIgnores: ['**/exceljs*.js', '**/saiae-og.png'],
        navigateFallback: '/index.html',
        // o manifest dinâmico e a fila do Supabase nunca devem ser
        // servidos pelo shell cacheado
        navigateFallbackDenylist: [/\/manifest\.webmanifest$/, /^\/rest\//, /^\/auth\//],
        // Fontes do redesign (Space Grotesk, Hanken Grotesk, JetBrains
        // Mono) são carregadas do Google Fonts — sem isso, elas não
        // ficariam disponíveis offline, quebrando a regra de Lançar
        // Pedido/Cozinha funcionarem sem internet.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
})
