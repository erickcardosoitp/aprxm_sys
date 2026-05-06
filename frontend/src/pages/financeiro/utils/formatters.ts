export const fmt = (v: string | number) => {
  const n = parseFloat(String(v))
  if (!isFinite(n)) return 'R$ 0,00'
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export const fmtDate = (s: string) => {
  const d = new Date(s)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export const fmtDateOnly = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}/${m}/${y.slice(2)}`
}

export const fmtRef = (ref: string) => {
  const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  const [y, m] = ref.split('-')
  return `${MONTHS[parseInt(m) - 1]}/${y}`
}

export const parseTxName = (desc: string, subtype: string | null | undefined, residentName?: string | null): string => {
  if (residentName) return residentName
  if (subtype && desc.includes(' — ')) return desc.split(' — ').slice(1).join(' — ')
  if (desc.startsWith('Estorno: ') && desc.includes(' — ')) {
    const rest = desc.replace('Estorno: ', '')
    if (rest.includes(' — ')) return 'Estorno: ' + rest.split(' — ').slice(1).join(' — ')
  }
  return desc
}

export const fmtCurrency = (v: string | number) =>
  `R$ ${parseFloat(String(v)).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
