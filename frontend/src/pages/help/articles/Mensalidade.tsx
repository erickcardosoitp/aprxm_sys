import { Link } from 'react-router-dom'

export default function Mensalidade() {
  return (
    <article className="prose prose-sm max-w-none">
      <h1>Mensalidades</h1>

      <p className="bg-blue-50 border border-blue-200 rounded-lg p-3 not-prose text-sm text-blue-700">
        ℹ️ <strong>Regra importante:</strong> pagamentos de mensalidade e emissão de comprovante de residência
        devem ser registrados pela <strong>sessão de caixa</strong> (menu <em>Caixa</em>).
        O menu <em>Financeiro → Cobranças</em> é apenas para consulta de histórico e geração de cobranças.
      </p>

      <h2>Registrar pagamento de mensalidade (via Caixa)</h2>
      <ol>
        <li>Abra o caixa. Se ainda não estiver aberto, veja <Link to="/help/abrir-caixa">como abrir o caixa →</Link></li>
        <li>Acesse <strong>Caixa → aba Caixa → Nova Transação</strong>.</li>
        <li>Selecione o tipo <strong>Entrada</strong> e o subtipo <strong>Mensalidade</strong>.</li>
        <li>Busque e selecione o <strong>morador</strong>.</li>
        <li>Informe a <strong>forma de pagamento</strong> (Dinheiro, PIX, etc.) e o <strong>valor</strong>.</li>
        <li>Toque em <strong>Confirmar</strong>.</li>
      </ol>
      <p>
        A transação é registrada na sessão do dia e aparece no extrato do caixa.
        O comprovante é gerado automaticamente para impressão.
      </p>

      <h2>Emitir comprovante de residência (via Caixa)</h2>
      <p>
        O comprovante de residência segue o mesmo fluxo — é gerado a partir de uma transação
        registrada na sessão de caixa aberta. Toda movimentação do dia deve passar pelo caixa.
      </p>

      <h2>Consultar histórico de mensalidades</h2>
      <p>
        Para ver o histórico de cobranças de um morador ou a situação de inadimplência:
      </p>
      <ol>
        <li>Acesse <strong>Financeiro → Cobranças</strong>.</li>
        <li>
          Escolha a sub-aba conforme a necessidade:
          <ul>
            <li><em>A Receber</em> — parcelas pendentes de todos os moradores.</li>
            <li><em>Inadimplentes</em> — moradores com parcelas vencidas.</li>
            <li><em>Pagos</em> — histórico de pagamentos por mês.</li>
            <li><em>Por Morador</em> — histórico completo de um morador específico.</li>
          </ul>
        </li>
      </ol>

      <h2>Gerar cobranças para o mês (administrador)</h2>
      <ol>
        <li>Acesse <strong>Financeiro → Cobranças → + Gerar Mês</strong> (borda verde tracejada).</li>
        <li>Selecione o mês, o dia de vencimento e o valor padrão.</li>
        <li>Toque em <strong>Gerar Mensalidades</strong>.</li>
      </ol>
      <p>
        O sistema cria cobranças para todos os associados ativos que ainda não têm registro no mês selecionado.
        Os pagamentos dessas cobranças devem ser registrados pela sessão de caixa.
      </p>

      <p>
        Veja também:{' '}
        <Link to="/help/abrir-caixa">Abrir e fechar caixa →</Link>{' | '}
        <Link to="/help/nova-transacao">Lançar transação no caixa →</Link>
      </p>
    </article>
  )
}
