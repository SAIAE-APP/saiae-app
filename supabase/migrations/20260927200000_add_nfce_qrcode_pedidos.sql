-- Cupom fiscal impresso (modelo/layout, sem gatilho de UI ainda) precisa de
-- mais dados da resposta da FocusNFe do que o que já era salvo
-- (nfce_status/nfce_chave/nfce_numero/nfce_mensagem): série, protocolo de
-- autorização, e a URL de QR Code de consulta (a FocusNFe monta essa URL
-- porque só ela guarda o CSC da SEFAZ — nós só temos o token de API em
-- barracas_fiscal_token, não dá pra montar essa URL sozinhos).
alter table public.pedidos
  add column nfce_serie text,
  add column nfce_protocolo text,
  add column nfce_qrcode_url text;
