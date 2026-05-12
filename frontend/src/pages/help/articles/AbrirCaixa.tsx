import { Link } from 'react-router-dom'

export default function AbrirCaixa() {
  return (
    <article className="prose prose-sm max-w-none">
      <h1>Abrir e fechar caixa</h1>
      <p>
        A sessão de caixa controla toda a movimentação financeira do turno.
        Nenhuma transação pode ser lançada sem uma sessão aberta.
        O caixa fica em <strong>Caixa → aba Caixa</strong>.
      </p>

      <h2>Abrir caixa</h2>
      <ol>
        <li>Acesse o menu <strong>Caixa</strong>.</li>
        <li>Toque em <strong>Abrir Caixa</strong>.</li>
        <li>Informe o <strong>saldo de abertura (R$)</strong> — o valor em espécie que está no caixa físico no início do turno.</li>
        <li>Toque em <strong>Confirmar</strong>.</li>
      </ol>
      <p>
        Com o caixa aberto, o painel exibe o saldo em tempo real e libera os botões
        <em>Nova Transação</em> e <em>Sangria</em>.
      </p>

      <h2>Fechar caixa</h2>
      <ol>
        <li>Toque em <strong>Fechar Caixa</strong>.</li>
        <li>
          O sistema exibe o <strong>saldo esperado</strong> (abertura + entradas − saídas − sangrias).
        </li>
        <li>Conte o dinheiro físico e informe o <strong>saldo contado (R$)</strong>.</li>
        <li>O sistema calcula automaticamente a diferença (sobra ou falta).</li>
        <li>Toque em <strong>Confirmar fechamento</strong>.</li>
      </ol>
      <p>
        Após o fechamento, a sessão fica arquivada em <strong>Caixa → aba Sessões</strong>
        e não pode mais receber novas transações.
      </p>

      <h2>Observações</h2>
      <ul>
        <li>Só pode haver uma sessão aberta por vez por associação.</li>
        <li>Transações lançadas fora da sessão (modo offline) não afetam o saldo do caixa.</li>
      </ul>

      <p>
        Veja também:{' '}
        <Link to="/help/nova-transacao">Lançar transação no caixa →</Link>{' | '}
        <Link to="/help/sangria">Fazer sangria →</Link>
      </p>
    </article>
  )
}
