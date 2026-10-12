// Ligação estática da importação do cardápio (Ajustes > Cardápio): botão, folha, recarga da lista e regras de segurança
// do caminho de gravação. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const ajustes = ler('../src/pages/Ajustes.tsx')
const folha = ler('../src/components/ImportarCardapioSheet.tsx')
const nucleo = ler('../src/lib/cardapioImportacaoNucleo.ts')
const arquivo = ler('../src/lib/importarClientesArquivo.ts')
const icones = new Set(ler('../src/assets/fonts/icones.txt').split(/\s+/).filter(Boolean))

describe('Ajustes > Cardápio', () => {
  test('botão "Importar de planilha" ao lado de "Novo item" abre a folha', () => {
    assert.match(ajustes, /import \{ ImportarCardapioSheet \} from '\.\.\/components\/ImportarCardapioSheet'/)
    assert.match(ajustes, /onClick=\{\(\) => setImportando\(true\)\}[\s\S]{0,200}Importar de planilha[\s\S]{0,400}Novo item/)
    assert.match(ajustes, /<ImportarCardapioSheet\s+aberto=\{importando\}\s+barracaId=\{barracaId\}/)
  })
  test('depois de importar, itens e categorias são relidos (as duas consultas dependem de `recarga`)', () => {
    assert.match(ajustes, /aoImportar=\{\(\) => setRecarga\(\(n\) => n \+ 1\)\}/)
    assert.equal((ajustes.match(/\}, \[barracaId, recarga\]\)/g) ?? []).length, 2)
  })
  test('a fileira de botões quebra linha em tela estreita (360 px) sem vazar', () => {
    assert.match(ajustes, /<div className="flex flex-wrap items-center gap-2">\s+<Button\s+variant="outline"\s+size="md"\s+icon=\{<Icone nome="category"/)
  })
})

describe('folha de importação', () => {
  test('etapas, planilha modelo e limite', () => {
    for (const trecho of ['Baixar planilha modelo', 'Escolher arquivo', 'Prévia de', 'Nada foi', 'itens novos', 'categorias novas', 'com erro', 'Linhas com erro', 'Importação concluída', 'Fechar']) {
      assert.ok(folha.includes(trecho), trecho)
    }
    assert.match(folha, /lerArquivoDeTabela\(arquivo, LIMITE_LINHAS_CARDAPIO\)/)
    assert.match(folha, /baixarArquivo\(gerarCsvModeloCardapio\(\), 'text\/csv;charset=utf-8', 'modelo-cardapio\.csv'\)/)
    assert.match(folha, /accept="\.csv,\.xlsx,/)
  })
  test('nada é gravado antes de confirmar; offline é recusado; fechar durante a gravação é bloqueado', () => {
    assert.ok(folha.indexOf('gravarCardapioImportado(') > folha.indexOf('async function confirmar'))
    assert.equal((folha.match(/gravarCardapioImportado\(/g) ?? []).length, 1)
    assert.match(folha, /if \(offline\(\)\) \{\s+setErro\(MSG_SEM_INTERNET\)/)
    assert.match(folha, /if \(ocupado\) return/)
  })
  test('resumo final: criados, categorias criadas, já existiam e com erro', () => {
    assert.match(folha, /itens criados[\s\S]*categorias criadas[\s\S]*já existiam[\s\S]*com erro/)
  })
  test('todo ícone usado existe na fonte própria (ícone fora do subset aparece como texto)', () => {
    for (const [, nome] of folha.matchAll(/nome="([a-z_]+)"/g)) assert.ok(icones.has(nome), nome)
    for (const nome of ['description', 'download', 'check_circle']) assert.ok(icones.has(nome), nome)
  })
})

describe('segurança do caminho de gravação', () => {
  test('só insere: nunca apaga, nunca sobrescreve, sem RPC; tudo pela RLS', () => {
    assert.ok(!/\.(delete|update|upsert|rpc)\(/.test(nucleo), 'o núcleo só pode inserir')
    assert.equal((nucleo.match(/\.insert\(/g) ?? []).length, 2)
  })
  test('campos fiscais, foto e estoque não são gravados', () => {
    for (const campo of ['ncm', 'cfop', 'unidade_comercial', 'foto_url', 'estoque_qtd']) assert.ok(!nucleo.includes(campo), campo)
  })
  test('exceljs só entra por import dinâmico (o bundle principal não o carrega nem o service worker o precacheia)', () => {
    assert.match(arquivo, /await import\('exceljs'\)/)
    assert.ok(!/^import .* from 'exceljs'/m.test(arquivo))
    assert.ok(!/from 'exceljs'/.test(folha))
    assert.match(ler('../vite.config.ts'), /globIgnores: \['\*\*\/exceljs\*\.js'/)
  })
})
