/** Masks CPF for display: ***.***.***-XX (shows only last 2 digits) */
export function maskCpf(cpf?: string | null): string {
  if (!cpf) return ''
  const digits = cpf.replace(/\D/g, '')
  if (digits.length !== 11) return cpf
  return `***.***.***-${digits.substring(9)}`
}
