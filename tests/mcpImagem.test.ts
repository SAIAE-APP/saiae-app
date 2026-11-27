// Download seguro de imagem do MCP (supabase/functions/mcp-saiae/imagem.ts): SSRF, redirects, limite e bytes. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { baixarImagemSegura, detectarImagem, ipPublico, validarUrlImagem, LIMITE_BYTES_IMAGEM } from '../supabase/functions/mcp-saiae/imagem.ts'

const png = (w: number, h: number) => {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}
const jpg = (w: number, h: number) => {
  // SOI, APP0 (16 bytes), SOF0 com altura e largura, depois enchimento.
  const b = new Uint8Array(40)
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3], 20)
  return b
}
const webpVp8x = (w: number, h: number) => {
  const b = new Uint8Array(40)
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0])
  b.set([(w - 1) & 255, ((w - 1) >> 8) & 255, ((w - 1) >> 16) & 255, (h - 1) & 255, ((h - 1) >> 8) & 255, ((h - 1) >> 16) & 255], 24)
  return b
}
const webpLossy = (w: number, h: number) => {
  const b = new Uint8Array(40)
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a])
  b.set([w & 255, w >> 8, h & 255, h >> 8], 26)
  return b
}

describe('ipPublico', () => {
  test('recusa loopback, redes privadas, link-local, metadata, CGNAT e reservados', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1']) {
      assert.equal(ipPublico(ip), false, ip)
    }
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.1.2.3', '64:ff9b::a00:1', '2002:7f00:1::1', '2001:db8::1', '2001:0:1::1']) {
      assert.equal(ipPublico(ip), false, ip)
    }
  })
  test('aceita endereço público e recusa texto que não é IP', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(ipPublico(ip), true, ip)
    for (const ip of ['', 'abc', '999.1.1.1', '1.2.3', '1:2:3', ':::']) assert.equal(ipPublico(ip), false, ip)
  })
})

describe('validarUrlImagem', () => {
  test('só https, porta 443, sem credenciais e sem host interno', () => {
    for (const u of [
      'http://exemplo.com/a.jpg', 'ftp://exemplo.com/a.jpg', 'file:///etc/passwd', 'https://user:senha@exemplo.com/a.jpg',
      'https://exemplo.com:8443/a.jpg', 'https://localhost/a.jpg', 'https://a.localhost/a.jpg', 'https://127.0.0.1/a.jpg',
      'https://[::1]/a.jpg', 'https://169.254.169.254/latest/meta-data', 'https://2130706433/a.jpg', 'https://0x7f.1/a.jpg',
      'https://intranet/a.jpg', 'https://servico.internal/a.jpg', 'https://impressora.local/a.jpg', 'https://10.0.0.1/a.jpg', '', 42, null,
    ]) {
      assert.equal(validarUrlImagem(u).ok, false, String(u))
    }
    assert.equal(validarUrlImagem('https://exemplo.com/foto.jpg').ok, true)
    assert.equal(validarUrlImagem('https://exemplo.com:443/foto.jpg').ok, true)
    assert.equal(validarUrlImagem('https://8.8.8.8/foto.jpg').ok, true)
  })
})

describe('detectarImagem', () => {
  test('identifica pelos bytes e lê as dimensões', () => {
    assert.deepEqual(detectarImagem(png(800, 600)), { tipo: 'png', largura: 800, altura: 600 })
    assert.deepEqual(detectarImagem(jpg(1024, 768)), { tipo: 'jpg', largura: 1024, altura: 768 })
    assert.deepEqual(detectarImagem(webpVp8x(1200, 900)), { tipo: 'webp', largura: 1200, altura: 900 })
    assert.deepEqual(detectarImagem(webpLossy(640, 480)), { tipo: 'webp', largura: 640, altura: 480 })
  })
  test('recusa SVG, HTML, GIF, arquivo truncado e vazio', () => {
    const t = (s: string) => new TextEncoder().encode(s.padEnd(64, ' '))
    assert.equal(detectarImagem(t('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null)
    assert.equal(detectarImagem(t('<html><script>alert(1)</script>')), null)
    assert.equal(detectarImagem(t('GIF89a')), null)
    assert.equal(detectarImagem(new Uint8Array(0)), null)
    assert.equal(detectarImagem(png(1, 1).slice(0, 10)), null)
  })
})

function simular(rotas: Record<string, () => Response>, dns: Record<string, string[]> = {}) {
  const chamadas: string[] = []
  const deps = {
    fetchFn: async (url: string) => {
      chamadas.push(url)
      const r = rotas[url]
      if (!r) throw new Error('rota inesperada ' + url)
      return r()
    },
    resolverDns: async (host: string) => {
      if (!(host in dns)) throw new Error('NXDOMAIN')
      return dns[host]
    },
  }
  return { deps, chamadas }
}
const ok = (bytes: Uint8Array, cab: Record<string, string> = {}) => () => new Response(bytes, { status: 200, headers: cab })
const redirect = (para: string, status = 302) => () => new Response(null, { status, headers: { location: para } })

describe('baixarImagemSegura', () => {
  test('baixa uma imagem válida; o Content-Type mentiroso não conta', async () => {
    const { deps } = simular({ 'https://cdn.exemplo.com/f.jpg': ok(png(800, 600), { 'content-type': 'text/html' }) }, { 'cdn.exemplo.com': ['93.184.216.34'] })
    const r = await baixarImagemSegura('https://cdn.exemplo.com/f.jpg', deps)
    assert.ok(r.ok)
    if (r.ok) assert.deepEqual([r.imagem.tipo, r.imagem.mime, r.imagem.largura, r.imagem.altura], ['png', 'image/png', 800, 600])
  })

  test('nome que resolve para IP interno (ou um dos IPs) é recusado sem chamar o fetch', async () => {
    for (const ips of [['127.0.0.1'], ['10.0.0.1'], ['93.184.216.34', '169.254.169.254'], ['::1'], []]) {
      const { deps, chamadas } = simular({}, { 'x.exemplo.com': ips })
      assert.equal((await baixarImagemSegura('https://x.exemplo.com/f.jpg', deps)).ok, false)
      assert.equal(chamadas.length, 0)
    }
    const semDns = simular({})
    assert.equal((await baixarImagemSegura('https://nao-existe.exemplo.com/f.jpg', semDns.deps)).ok, false)
  })

  test('redirect: segue até 3, revalida cada destino e recusa o que aponta para dentro', async () => {
    const dns = { 'a.com': ['8.8.8.8'], 'b.com': ['8.8.4.4'], 'c.com': ['1.1.1.1'], 'd.com': ['1.0.0.1'], 'mau.com': ['127.0.0.1'] }
    const tres = simular({
      'https://a.com/1': redirect('https://b.com/2'),
      'https://b.com/2': redirect('/3', 301),
      'https://b.com/3': redirect('https://c.com/4', 307),
      'https://c.com/4': ok(jpg(100, 100)),
    }, dns)
    assert.equal((await baixarImagemSegura('https://a.com/1', tres.deps)).ok, true)
    assert.equal(tres.chamadas.length, 4)

    const quatro = simular({
      'https://a.com/1': redirect('https://b.com/2'), 'https://b.com/2': redirect('https://c.com/3'),
      'https://c.com/3': redirect('https://d.com/4'), 'https://d.com/4': redirect('https://a.com/5'), 'https://a.com/5': ok(jpg(1, 1)),
    }, dns)
    assert.equal((await baixarImagemSegura('https://a.com/1', quatro.deps)).ok, false)
    assert.equal(quatro.chamadas.includes('https://a.com/5'), false)

    for (const alvo of ['http://a.com/x', 'https://mau.com/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'file:///etc/passwd', 'https://[::1]/x']) {
      const s = simular({ 'https://a.com/1': redirect(alvo) }, dns)
      assert.equal((await baixarImagemSegura('https://a.com/1', s.deps)).ok, false, alvo)
      assert.deepEqual(s.chamadas, ['https://a.com/1'], alvo)
    }
    const semLocation = simular({ 'https://a.com/1': () => new Response(null, { status: 302 }) }, dns)
    assert.equal((await baixarImagemSegura('https://a.com/1', semLocation.deps)).ok, false)
  })

  test('limite de 5 MB vale pelo Content-Length e pelo corpo real', async () => {
    const grande = new Uint8Array(LIMITE_BYTES_IMAGEM + 1)
    grande.set(png(10, 10))
    const dns = { 'a.com': ['8.8.8.8'] }
    const declarado = simular({ 'https://a.com/f': ok(grande, { 'content-length': String(grande.length) }) }, dns)
    assert.equal((await baixarImagemSegura('https://a.com/f', declarado.deps)).ok, false)
    const mentiu = simular({ 'https://a.com/f': ok(grande, { 'content-length': '100' }) }, dns)
    assert.equal((await baixarImagemSegura('https://a.com/f', mentiu.deps)).ok, false)
    const limite = new Uint8Array(LIMITE_BYTES_IMAGEM)
    limite.set(png(10, 10))
    assert.equal((await baixarImagemSegura('https://a.com/f', simular({ 'https://a.com/f': ok(limite) }, dns).deps)).ok, true)
  })

  test('recusa não-imagem, dimensões absurdas e erro HTTP', async () => {
    const dns = { 'a.com': ['8.8.8.8'] }
    const html = new TextEncoder().encode('<html>'.padEnd(64, ' '))
    assert.equal((await baixarImagemSegura('https://a.com/f', simular({ 'https://a.com/f': ok(html, { 'content-type': 'image/jpeg' }) }, dns).deps)).ok, false)
    assert.equal((await baixarImagemSegura('https://a.com/f', simular({ 'https://a.com/f': ok(png(50000, 50000)) }, dns).deps)).ok, false)
    assert.equal((await baixarImagemSegura('https://a.com/f', simular({ 'https://a.com/f': ok(png(0, 10)) }, dns).deps)).ok, false)
    assert.equal((await baixarImagemSegura('https://a.com/f', simular({ 'https://a.com/f': () => new Response('x', { status: 404 }) }, dns).deps)).ok, false)
    assert.equal((await baixarImagemSegura('https://a.com/f', { fetchFn: async () => { throw new Error('rede') }, resolverDns: async () => ['8.8.8.8'] })).ok, false)
  })
})
