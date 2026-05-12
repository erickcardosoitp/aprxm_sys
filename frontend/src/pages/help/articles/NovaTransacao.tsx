import { Link } from 'react-router-dom'

export default function NovaTransacao() {
  return (
    <article className="prose prose-sm max-w-none">
      <h1>Lançar transação no caixa</h1>
      <p>
        Transações registram entradas e saídas durante uma sessão de caixa aberta.
        Acesse em <strong>Caixa → aba Caixa → Nova Transação</strong>.
      </p>

      <h2>Entrada (receita)</h2>
      <ol>
        <li>Com o caixa aberto, toque em <strong>Nova Transação</strong>.</li>
        <li>Selecione o tipo <strong>Entrada</strong>.</li>
        <li>
          Escolha o subtipo:
          <ul>
            <li><em>Mensalidade</em> — pagamento de mensalidade de morador.</li>
            <li><em>Taxa de entrega</em> — taxa cobrada na entrega de encomenda.</li>
            <li><em>Outro</em> — qualquer outra receita avulsa.</li>
          </ul>
        </li>
        <li>Busque o morador (opcional, mas recomendado para rastreabilidade).</li>
        <li>Selecione a <strong>forma de pagamento</strong>.</li>
        <li>Informe o <strong>valor (R$)</strong> e uma descrição.</li>
        <li>Toque em <strong>Confirmar</strong>.</li>
      </ol>

      <h2>Saída (despesa)</h2>
      <ol>
        <li>Toque em <strong>Nova Transação → Saída</strong>.</li>
        <li>Preencha a descrição, categoria e valor.</li>
        <li>Se a despesa precisar de aprovação, ela ficará com status <em>Pendente</em> até ser aprovada por um administrador.</li>
        <li>Toque em <strong>Confirmar</strong>.</li>
      </ol>

      <h2>Lançamento sem caixa (offline)</h2>
      <p>
        Para registrar uma movimentação <strong>sem sessão aberta</strong> (ex: pagamento recebido fora do turno):
      </p>
      <ol>
        <li>Toque em <strong>Lançamento sem caixa</strong>.</li>
        <li>Escolha Entrada ou Saída, preencha os dados e confirme.</li>
      </ol>
      <p className="bg-blue-50 border border-blue-200 rounded-lg p-3 not-prose text-sm text-blue-700">
        ℹ️ Lançamentos offline aparecem no Extrato mas <strong>não afetam o saldo</strong> da sessão de caixa atual.
      </p>

      <h2>Estornar uma transação</h2>
      <ol>
        <li>Na lista de transações, toque no ícone <strong>↺</strong> (estornar) ao lado da transação.</li>
        <li>Informe o <strong>motivo do estorno</strong> (mínimo 5 caracteres) e a <strong>senha de administrador</strong>.</li>
        <li>Toque em <strong>Confirmar Estorno</strong>.</li>
      </ol>
      <p>
        Uma transação inversa é criada automaticamente. A original fica marcada como estornada.
      </p>

      <p>
        Veja também:{' '}
        <Link to="/help/abrir-caixa">Abrir e fechar caixa →</Link>{' | '}
        <Link to="/help/sangria">Fazer sangria →</Link>
      </p>
    </article>
  )
}
