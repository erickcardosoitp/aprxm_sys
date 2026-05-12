import { Link } from 'react-router-dom'
import { ArticleWrapper } from './ArticleWrapper'

export default function EncomendasUnitario() {
  return (
    <ArticleWrapper>
      <h1>Receber encomenda (unitário)</h1>
      <p>Use este fluxo para registrar <strong>uma única encomenda</strong> avulsa.</p>

      <h2>Passo a passo</h2>
      <ol>
        <li>Acesse o menu <strong>Encomendas</strong> na barra de navegação.</li>
        <li>Toque no botão <strong>+ Receber</strong> (canto superior direito).</li>
        <li>Escaneie o código de barras do volume ou digite o código manualmente.</li>
        <li>Selecione o <strong>morador destinatário</strong> usando a busca por nome ou apartamento.</li>
        <li>Escolha a <strong>transportadora</strong> (Correios, Mercado Livre, etc.).</li>
        <li>Tire uma <strong>foto do volume</strong> (obrigatória) e toque em <strong>Confirmar</strong>.</li>
      </ol>

      <p>
        O sistema envia automaticamente uma notificação ao morador e registra a encomenda
        com status <em>Aguardando retirada</em>.
      </p>

      <h2>Observações</h2>
      <ul>
        <li>Para moradores não-membros, o sistema aplica automaticamente a taxa de R$ 2,50.</li>
        <li>Se o código de barras não for lido, toque no ícone de teclado para digitação manual.</li>
      </ul>

      <p>
        Precisa lançar várias encomendas de uma vez?{' '}
        <Link to="/help/encomendas-multiplo">Veja o fluxo de recebimento múltiplo →</Link>
      </p>
    </ArticleWrapper>
  )
}
