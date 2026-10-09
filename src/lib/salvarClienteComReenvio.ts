// Salvar o cliente de um pedido de Entrega no cadastro da barraca, DEPOIS de o pedido ter entrado. Se falhar, a falha
// não pode mais sumir no console (H2: o cliente não aparecia no 2º pedido e ninguém soube por quê): o operador é avisado
// e o salvamento vira uma operação da fila, que tenta de novo sozinha. PURO (dependências injetadas), testado em
// tests/clientesEntregaSalvo.test.ts.

export type DesfechoSalvarCliente = 'salvo' | 'na_fila' | 'perdido'

/** Tenta salvar agora; se falhar, avisa e enfileira o reenvio. Nunca lança (o pedido já está criado). */
export async function salvarClienteComReenvio(deps: {
  salvar: () => Promise<unknown>
  enfileirar: () => Promise<unknown>
  avisar: () => void
}): Promise<DesfechoSalvarCliente> {
  try {
    await deps.salvar()
    return 'salvo'
  } catch {
    // cai no reenvio
  }
  try {
    deps.avisar()
  } catch {
    // o aviso é conforto; o reenvio vale mais
  }
  try {
    await deps.enfileirar()
    return 'na_fila'
  } catch {
    return 'perdido'
  }
}
