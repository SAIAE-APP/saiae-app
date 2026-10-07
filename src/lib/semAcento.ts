/** Impressoras térmicas genéricas (as "BlueTooth Printer" chinesas) quase
 * nunca têm a tabela de caracteres que o encoder assume — acento saía "?".
 * Tirar o acento é o único jeito garantido em qualquer modelo. */
export function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/×/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
}
