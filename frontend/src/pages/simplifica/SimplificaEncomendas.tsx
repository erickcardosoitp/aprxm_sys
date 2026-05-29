import { useState } from 'react'
import { PackagePlus, PackageCheck, Undo2, Plus, Search, ClipboardList } from 'lucide-react'
import { SimplificaHeader } from './components/SimplificaHeader'
import { SimplificaTile } from './components/SimplificaTile'
import { SECTOR_COLORS } from './theme'
import { ReceberTela } from './encomendas/ReceberTela'
import { RetiradaTela } from './encomendas/RetiradaTela'
import { DevolucaoSheet } from './encomendas/DevolucaoSheet'
import { CadastroSheet } from './encomendas/CadastroSheet'
import { ConsultarTela } from './encomendas/ConsultarTela'
import { MinhasTela } from './encomendas/MinhasTela'

type Tela = 'receber' | 'retirada' | 'consultar' | 'minhas' | null
type Sheet = 'devolucao' | 'cadastro' | null

export default function SimplificaEncomendas() {
  const [tela, setTela] = useState<Tela>(null)
  const [sheet, setSheet] = useState<Sheet>(null)

  return (
    <div className="flex flex-col min-h-screen">
      <SimplificaHeader title="Encomendas" showBack />

      <main className="flex-1 p-4 grid grid-cols-2 gap-4 content-start">
        <SimplificaTile icon={PackagePlus}   label="Receber"           color={SECTOR_COLORS.encomendas} onClick={() => setTela('receber')} />
        <SimplificaTile icon={PackageCheck}  label="Retirada"          color={SECTOR_COLORS.encomendas} onClick={() => setTela('retirada')} />
        <SimplificaTile icon={Undo2}         label="Devolução"         color={SECTOR_COLORS.encomendas} onClick={() => setSheet('devolucao')} />
        <SimplificaTile icon={Plus}          label="Cadastros"         color={SECTOR_COLORS.encomendas} onClick={() => setSheet('cadastro')} />
        <SimplificaTile icon={Search}        label="Consultar"         color={SECTOR_COLORS.encomendas} onClick={() => setTela('consultar')} />
        <SimplificaTile icon={ClipboardList} label="Minhas Encomendas" color={SECTOR_COLORS.encomendas} onClick={() => setTela('minhas')} />
      </main>

      {/* Telas full-screen */}
      {tela === 'receber'  && <ReceberTela   onClose={() => setTela(null)} />}
      {tela === 'retirada' && <RetiradaTela  onClose={() => setTela(null)} />}
      {tela === 'consultar'&& <ConsultarTela onClose={() => setTela(null)} />}
      {tela === 'minhas'   && <MinhasTela    onClose={() => setTela(null)} />}

      {/* Sheets */}
      <DevolucaoSheet open={sheet === 'devolucao'} onClose={() => setSheet(null)} />
      <CadastroSheet  open={sheet === 'cadastro'}  onClose={() => setSheet(null)} />
    </div>
  )
}
