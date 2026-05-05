import { fmt, fmtRef } from './formatters'
import type { Mensalidade } from '../types/financeiro'

export function printRecibo(
  residentName: string,
  residentCpf: string | undefined,
  residentUnit: string | undefined,
  allMensalidades: Mensalidade[],
  paidNow: Mensalidade,
  paymentMethodLabel: string,
  operator: string,
  assocName: string,
  paymentMethodLabel2?: string,
  amount2?: number,
) {
  const sd = (s: string | null | undefined) => {
    if (!s) return '—'
    const d = new Date(s)
    return isNaN(d.getTime()) ? s : d.toLocaleDateString('pt-BR')
  }

  const paid = allMensalidades
    .filter(m => m.status === 'paid')
    .sort((a, b) => a.reference_month.localeCompare(b.reference_month))

  const defaultAmount = allMensalidades.length
    ? parseFloat(allMensalidades[allMensalidades.length - 1].amount)
    : parseFloat(paidNow.amount)

  const emitido = new Date().toLocaleString('pt-BR')

  const stub = (via: 'interno' | 'morador') => `
<div style="width:76mm;font-family:'Courier New',monospace;font-size:7.5pt;page-break-inside:avoid;margin-bottom:4mm">
  <div style="text-align:center;padding:2.5mm 2mm 2mm;border-bottom:2px solid #111">
    <div style="font-size:9.5pt;font-weight:bold;letter-spacing:.5px;text-transform:uppercase">${assocName || 'Associação'}</div>
    <div style="font-size:6pt;margin-top:.5mm;letter-spacing:.3px">COMPROVANTE DE MENSALIDADE</div>
    <div style="display:inline-block;margin-top:1mm;font-size:5.5pt;font-weight:bold;border:1px solid #111;padding:0.5mm 2mm">
      ${via === 'interno' ? '1ª VIA — CONTROLE INTERNO' : '2ª VIA — MORADOR'}
    </div>
  </div>
  <div style="padding:2mm 2mm 1.5mm;border-bottom:1px dashed #999">
    <div style="display:flex;justify-content:space-between"><span style="color:#555">Associado</span><span style="font-weight:bold;text-align:right;max-width:46mm;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${residentName}</span></div>
    ${residentCpf ? `<div style="display:flex;justify-content:space-between"><span style="color:#555">CPF</span><span style="font-weight:bold">${residentCpf}</span></div>` : ''}
    ${residentUnit ? `<div style="display:flex;justify-content:space-between"><span style="color:#555">Unidade</span><span style="font-weight:bold">${residentUnit}</span></div>` : ''}
  </div>
  <div style="padding:2mm;border-bottom:1px dashed #999">
    <div style="font-size:6pt;font-weight:bold;letter-spacing:.3px;color:#555;margin-bottom:1mm">PAGAMENTO EFETUADO</div>
    <div style="display:flex;justify-content:space-between"><span style="color:#555">Competência</span><span style="font-weight:bold">${fmtRef(paidNow.reference_month)}</span></div>
    <div style="display:flex;justify-content:space-between"><span style="color:#555">Data</span><span style="font-weight:bold">${sd(paidNow.paid_at)}</span></div>
    <div style="display:flex;justify-content:space-between;margin-top:1mm"><span style="color:#555">Total pago</span><span style="font-size:10pt;font-weight:bold">${fmt(paidNow.amount)}</span></div>
    ${via === 'interno' && amount2 && paymentMethodLabel2 ? `
    <div style="margin-top:1mm;padding-top:1mm;border-top:1px dotted #ccc">
      <div style="display:flex;justify-content:space-between"><span style="color:#555">${paymentMethodLabel}</span><span style="font-weight:bold">${fmt(parseFloat(paidNow.amount) - amount2)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#555">${paymentMethodLabel2}</span><span style="font-weight:bold">${fmt(amount2)}</span></div>
    </div>` : via === 'interno' ? `<div style="display:flex;justify-content:space-between"><span style="color:#555">Forma pagto</span><span style="font-weight:bold">${paymentMethodLabel}</span></div>` : ''}
  </div>
  <div style="padding:2mm;border-bottom:1px dashed #999;background:#f9f9f9">
    <div style="display:flex;justify-content:space-between">
      <span style="color:#555">Mensalidade padrão</span>
      <span style="font-weight:bold">${fmt(defaultAmount)}</span>
    </div>
    <div style="display:flex;justify-content:space-between">
      <span style="color:#555">Vencimento padrão</span>
      <span style="font-weight:bold">Todo dia ${paidNow.due_date ? new Date(paidNow.due_date).getDate() : '—'}</span>
    </div>
  </div>
  <div style="padding:2mm;border-bottom:1px dashed #999">
    <div style="font-size:6pt;font-weight:bold;letter-spacing:.3px;color:#555;margin-bottom:1.5mm">MESES PAGOS (${paid.length})</div>
    ${paid.length === 0
      ? '<div style="color:#999;font-size:6.5pt">Nenhum pagamento registrado.</div>'
      : `<div style="display:flex;flex-wrap:wrap;gap:1mm">${paid.map(m =>
          `<span style="font-size:6pt;padding:0.5mm 1.5mm;border:1px solid #26619c;border-radius:2px;color:#26619c;font-weight:bold">${fmtRef(m.reference_month)}</span>`
        ).join('')}</div>`
    }
  </div>
  <div style="padding:2mm;font-size:6pt">
    <div style="display:flex;justify-content:space-between">
      <span style="color:#555">Operador</span>
      <span style="font-weight:bold">${operator || '______________________'}</span>
    </div>
    <div style="margin-top:2.5mm;color:#555">Assinatura / Carimbo:</div>
    <div style="border-bottom:1px solid #999;height:7mm;margin-top:1mm"></div>
    <div style="margin-top:1.5mm;color:#aaa;font-size:5pt">Emitido em ${emitido}</div>
  </div>
</div>`

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Comprovante</title>
<style>
  @page{size:80mm auto;margin:2mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:80mm;background:#fff}
</style>
</head><body>
  ${stub('interno')}
  <div style="border-top:1px dotted #ccc;margin:1mm 0 3mm"></div>
  ${stub('morador')}
</body></html>`

  const w = window.open('', '_blank', 'width=400,height=800')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print() }, 400)
}
