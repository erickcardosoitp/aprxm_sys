import { Image } from 'lucide-react'
import EscModulePage from './EscModulePage'
import EscEmptySection from './EscEmptySection'

export default function AcervoPage() {
  return (
    <EscModulePage
      title="Acervo"
      description="Fotos, vídeos e posts do website — todas as unidades."
      icon={Image}
      sections={[
        { key: 'fotos', label: 'Fotos e Vídeos', content: <EscEmptySection columns={['Arquivo', 'Unidade', 'Enviado em']} /> },
        { key: 'posts', label: 'Posts Website', content: <EscEmptySection columns={['Título', 'Unidade', 'Publicado em']} /> },
      ]}
    />
  )
}
