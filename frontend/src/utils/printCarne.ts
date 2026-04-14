export interface CarneEntry {
  reference_month: string
  amount: string
  due_date?: string | null
  status: string
  paid_at?: string | null
  tipo?: string | null
}

export interface CarneResident {
  full_name: string
  cpf?: string | null
  unit?: string | null
  block?: string | null
}

const MONTH_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function sd(s: string | null | undefined): string {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('pt-BR')
}

export function printCarne(
  resident: CarneResident,
  mensalidades: CarneEntry[],
  assocName: string,
  opts?: { operatorName?: string; logoUrl?: string },
) {
  const now = new Date()
  const year = now.getFullYear()

  // Build map of existing mensalidades by ref
  const byRef: Record<string, CarneEntry> = {}
  for (const m of mensalidades) byRef[m.reference_month] = m

  // Default amount: last known value
  const sorted = [...mensalidades].sort((a, b) => a.reference_month.localeCompare(b.reference_month))
  const defaultAmount = sorted.length > 0 ? parseFloat(sorted[sorted.length - 1].amount).toFixed(2) : '0.00'

  // Months: current month → December of current year (max 12)
  const months: Array<{
    ref: string; label: string; amount: string; due: string
    status: string; paid_at?: string; isAcordo: boolean
  }> = []

  for (let mo = now.getMonth(); mo <= 11 && months.length < 12; mo++) {
    const ref = `${year}-${String(mo + 1).padStart(2, '0')}`
    const existing = byRef[ref]
    months.push({
      ref,
      label: `${MONTH_PT[mo]} ${year}`,
      amount: existing ? parseFloat(existing.amount).toFixed(2) : defaultAmount,
      due: existing?.due_date ? sd(existing.due_date) : '—',
      status: existing?.status ?? 'pending',
      paid_at: existing?.paid_at ?? undefined,
      isAcordo: existing?.tipo === 'acordo' || existing?.status === 'agreement',
    })
  }

  const SC: Record<string, string> = { paid: '#16a34a', pending: '#d97706', overdue: '#dc2626', agreement: '#7c3aed' }
  const SL: Record<string, string> = { paid: 'PAGO', pending: 'PENDENTE', overdue: 'EM ATRASO', agreement: 'ACORDO' }
  const logoHtml = opts?.logoUrl
    ? `<img src="${opts.logoUrl}" style="height:9mm;max-width:28mm;object-fit:contain;display:block;margin:0 auto 1mm" />`
    : ''

  const stubs = months.map(m => {
    const isPaid = m.status === 'paid'
    const isAcordo = m.isAcordo || m.status === 'agreement'
    const borderStyle = isAcordo ? 'border:2px dashed #7c3aed' : 'border-bottom:1px dashed #999'
    const headerBg = isAcordo ? 'background:#f5f3ff;border-bottom:1px solid #7c3aed' : 'border-bottom:1px solid #000'

    return `<div class="stub" style="${borderStyle};padding:4mm 4mm 3mm;page-break-inside:avoid">
      <div class="stub-header" style="${headerBg};padding-bottom:1.5mm;margin-bottom:2mm">
        ${logoHtml}
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-size:6.5pt;font-weight:bold;text-transform:uppercase;max-width:48mm;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${assocName}</span>
          <span style="font-size:8pt;font-weight:bold;white-space:nowrap;${isAcordo ? 'color:#7c3aed' : ''}">${m.label}</span>
        </div>
        ${isAcordo ? '<div style="font-size:5.5pt;color:#7c3aed;font-weight:bold;text-align:center;margin-top:0.5mm">— ACORDO —</div>' : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:0.8mm;margin-bottom:2mm">
        <div class="row"><span class="lbl">Associado</span><span class="val">${resident.full_name}</span></div>
        ${resident.unit ? `<div class="row"><span class="lbl">Unidade</span><span class="val">${resident.unit}${resident.block ? `/Bl.${resident.block}` : ''}</span></div>` : ''}
        ${resident.cpf ? `<div class="row"><span class="lbl">CPF</span><span class="val">${resident.cpf}</span></div>` : ''}
        <div class="row"><span class="lbl">Vencimento</span><span class="val">${m.due}</span></div>
        <div class="row" style="margin-top:1mm"><span class="lbl">Valor</span><span style="font-size:9pt;font-weight:bold;color:${isAcordo ? '#7c3aed' : '#111'}">R$ ${m.amount}</span></div>
        ${isPaid
          ? `<div class="row"><span class="lbl">Valor pago</span><span class="val" style="color:#16a34a">R$ ${m.amount}</span></div>
             <div class="row"><span class="lbl">Pago em</span><span class="val">${sd(m.paid_at)}</span></div>`
          : `<div class="row"><span class="lbl">Valor pago</span><span class="val" style="border-bottom:1px solid #999;width:28mm;display:inline-block">&nbsp;</span></div>
             <div class="row"><span class="lbl">Pago em</span><span class="val" style="border-bottom:1px solid #999;width:28mm;display:inline-block">&nbsp;</span></div>`}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid ${isAcordo ? '#7c3aed' : '#ccc'};padding-top:1.5mm">
        <div>
          <span style="font-size:7pt;font-weight:bold;color:${SC[m.status] ?? '#888'}">${SL[m.status] ?? m.status.toUpperCase()}</span>
          <div style="margin-top:2mm;font-size:5.5pt;color:#555">Operador: ${opts?.operatorName ? `<strong>${opts.operatorName}</strong>` : '<span style="border-bottom:1px solid #999;display:inline-block;width:22mm">&nbsp;</span>'}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:0.5mm">
          <div style="width:26mm;height:7mm;border-bottom:1px solid #000"></div>
          <span style="font-size:5.5pt;color:#666">Ass./Carimbo</span>
        </div>
      </div>
    </div>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Carnê — ${resident.full_name}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Courier New', monospace; }
    body { width: 80mm; background: #fff; }
    .row { display: flex; justify-content: space-between; gap: 2mm; }
    .lbl { font-size: 6.5pt; color: #555; white-space: nowrap; }
    .val { font-size: 6.5pt; font-weight: bold; text-align: right; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 50mm; }
  </style></head><body>${stubs}</body></html>`

  const w = window.open('', '_blank', 'width=400,height=700')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 400)
}
