import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'android']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    rules: {
      // DÍVIDA TÉCNICA: 13 ocorrências do padrão "setCarregando(true) no início
      // do fetch" / leitura de cache offline dentro de useEffect. Corrigir muda
      // o fluxo de carregamento (inclusive o do app offline), então ficou como
      // aviso para o CI barrar todo o resto. Lista em docs/divida-tecnica-lint.md.
      'react-hooks/set-state-in-effect': 'warn',
    },
    languageOptions: {
      globals: globals.browser,
    },
  },
])
