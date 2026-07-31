import { CheckCircle2 } from 'lucide-react'
import EscModulePage from './EscModulePage'
import PublicacoesPendentesSection from './PublicacoesPendentesSection'
import SolicitacoesSection from './SolicitacoesSection'
import DiretorioCadastrosPendentesSection from './DiretorioCadastrosPendentesSection'
import DiretorioSugestoesPendentesSection from './DiretorioSugestoesPendentesSection'
import CommunityModerationPage from '../community/CommunityModerationPage'
import DirectoryStaffPage from '../directory/DirectoryStaffPage'

function ScrollWrap({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto">{children}</div>
}

export default function AprovacoesPage() {
  return (
    <EscModulePage
      title="Comunidade"
      description="Controle total do que os moradores publicam e cadastram — fila de pendentes, solicitações abertas, e edição/exclusão de publicações, comentários e lugares do diretório."
      icon={CheckCircle2}
      sections={[
        { key: 'publicacoes-pendentes', label: 'Pendentes — Publicações', content: <PublicacoesPendentesSection /> },
        { key: 'solicitacoes', label: 'Solicitações', content: <SolicitacoesSection /> },
        { key: 'diretorio-cadastros-pendentes', label: 'Pendentes — Cadastros', content: <DiretorioCadastrosPendentesSection /> },
        { key: 'diretorio-sugestoes-pendentes', label: 'Pendentes — Sugestões', content: <DiretorioSugestoesPendentesSection /> },
        { key: 'publicacoes-todas', label: 'Todas as Publicações', content: <ScrollWrap><CommunityModerationPage /></ScrollWrap> },
        { key: 'diretorio-completo', label: 'Diretório Completo', content: <ScrollWrap><DirectoryStaffPage /></ScrollWrap> },
      ]}
    />
  )
}
