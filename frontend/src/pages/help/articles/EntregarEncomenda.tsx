import { Link } from 'react-router-dom'
import { ArticleWrapper } from './ArticleWrapper'

export default function EntregarEncomenda() {
  return (
    <ArticleWrapper>
      <h1>Entregar encomenda</h1>
      <p>
        Após o morador vir buscar o pacote, registre a entrega para atualizar o status
        e gerar o comprovante com assinatura.
      </p>

      <h2>Passo a passo</h2>
      <ol>
        <li>Acesse <strong>Encomendas</strong>.</li>
        <li>Localize o pacote na lista ou no Kanban (coluna <em>Aguardando</em> ou <em>Notificado</em>).</li>
        <li>Toque no card da encomenda para abrir os detalhes.</li>
        <li>Toque em <strong>✓ Entregar</strong> (botão verde).</li>
        <li>
          Preencha os dados da entrega:
          <ul>
            <li><strong>Entregue para</strong> — nome de quem retirou (autocomplete com dependentes do morador).</li>
            <li><strong>CPF de quem recebeu</strong> — opcional, mas recomendado.</li>
            <li><strong>Pessoa que entrega</strong> — nome do operador responsável.</li>
          </ul>
        </li>
        <li>Capture a <strong>assinatura</strong> do morador na tela (campo de assinatura digital).</li>
        <li>Tire ou anexe uma <strong>foto da entrega</strong> (opcional).</li>
        <li>Toque em <strong>Confirmar Entrega</strong>.</li>
      </ol>

      <p>
        O status muda para <em>Entregue</em> (verde) e a encomenda sai da fila de pendentes.
      </p>

      <h2>Devolver encomenda</h2>
      <p>
        Se o morador não retirar e o prazo vencer, registre a devolução:
      </p>
      <ol>
        <li>Abra os detalhes da encomenda e toque em <strong>↩ Devolver</strong>.</li>
        <li>Informe o <strong>motivo da devolução</strong>.</li>
        <li>Toque em <strong>Confirmar Devolução</strong>.</li>
      </ol>

      <h2>Estornar entrega</h2>
      <p>
        Para desfazer um registro de entrega feito por engano:
      </p>
      <ol>
        <li>Abra os detalhes e toque em <strong>⟲ Estornar</strong>.</li>
        <li>Informe o motivo e a <strong>senha de administrador</strong>.</li>
        <li>Confirme.</li>
      </ol>

      <p>
        Ainda não recebeu o pacote?{' '}
        <Link to="/help/encomendas-unitario">Veja como receber uma encomenda →</Link>
      </p>
    </ArticleWrapper>
  )
}
