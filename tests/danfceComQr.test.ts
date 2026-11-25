// Injeção do QR no DANFCe baixado: com e sem QR no HTML, fallback pelo XML e escape.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { garantirQrNoDanfce, qrDoXml } from '../src/lib/danfceComQr.ts'

const URL_QR = 'https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=123|2|2|1|abc'

describe('garantirQrNoDanfce', () => {
  test('sem QR no HTML: acrescenta SVG e o texto antes de </body>', () => {
    const r = garantirQrNoDanfce('<html><body><p>nota</p></body></html>', URL_QR)
    assert.match(r, /<svg[\s\S]*<\/svg>/)
    assert.match(r, /Consulte pela Chave de Acesso/)
    assert.ok(r.indexOf('<svg') < r.indexOf('</body>'))
    assert.doesNotMatch(r, /<script/i)
  })

  test('HTML que já tem QR em <img>: não duplica', () => {
    const html = '<body><img src="qrcode.png"></body>'
    assert.equal(garantirQrNoDanfce(html, URL_QR), html)
  })

  test('sem </body>: acrescenta no fim', () => {
    assert.match(garantirQrNoDanfce('<p>x</p>', URL_QR), /<p>x<\/p><div[\s\S]*<svg/)
  })

  test('sem url: usa o <qrCode> do XML (CDATA); sem nenhum, devolve intacto', () => {
    const xml = `<infNFeSupl><qrCode><![CDATA[${URL_QR}]]></qrCode></infNFeSupl>`
    assert.equal(qrDoXml(xml), URL_QR)
    assert.match(garantirQrNoDanfce('<body></body>', null, xml), /<svg/)
    assert.equal(garantirQrNoDanfce('<body></body>', null, '<xml/>'), '<body></body>')
  })

  test('escapa a url no texto do link e no atributo', () => {
    const r = garantirQrNoDanfce('<body></body>', 'https://x.com/?a=1&b="<s>"')
    assert.match(r, /a=1&amp;b=&quot;&lt;s&gt;&quot;/)
    assert.doesNotMatch(r, /<s>/)
  })

  test('url longa demais para o QR: devolve o HTML intacto', () => {
    const html = '<body></body>'
    assert.equal(garantirQrNoDanfce(html, 'https://x.com/' + 'a'.repeat(500)), html)
  })
})
