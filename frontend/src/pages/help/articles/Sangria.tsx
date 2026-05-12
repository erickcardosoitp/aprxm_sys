import { Link } from 'react-router-dom'
import { ArticleWrapper } from './ArticleWrapper'

export default function Sangria() {
  return (
    <ArticleWrapper>
      <h1>Fazer sangria</h1>
      <p>
        A sangria é a retirada de dinheiro do caixa durante o turno — por exemplo,
        para guardar excesso de troco ou fazer um depósito parcial.
        Ela reduz o saldo do caixa e fica registrada no histórico da sessão.
      </p>

      <h2>Passo a passo</h2>
      <ol>
        <li>Com o caixa aberto, acesse <strong>Caixa → aba Caixa</strong>.</li>
        <li>Toque em <strong>Sangria</strong>.</li>
        <li>Informe o <strong>valor da sangria (R$)</strong>.</li>
        <li>Informe o <strong>motivo</strong> (opcional, mas recomendado para auditoria).</li>
        <li>Toque em <strong>Confirmar Sangria</strong>.</li>
      </ol>

      <p>
        O saldo do caixa é reduzido imediatamente. A sangria aparece na lista de
        movimentações da sessão com cor âmbar.
      </p>

      <h2>Observações</h2>
      <ul>
        <li>Sangrias só podem ser feitas com sessão de caixa aberta.</li>
        <li>O valor da sangria é descontado do saldo esperado no fechamento do caixa.</li>
        <li>Não é possível estornar uma sangria diretamente — em caso de erro, lance uma entrada avulsa para compensar.</li>
      </ul>

      <p>
        Veja também:{' '}
        <Link to="/help/abrir-caixa">Abrir e fechar caixa →</Link>{' | '}
        <Link to="/help/nova-transacao">Lançar transação →</Link>
      </p>
    </ArticleWrapper>
  )
}
