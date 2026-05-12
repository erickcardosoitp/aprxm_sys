import { Link } from 'react-router-dom'

export default function Mensalidade() {
  return (
    <article className="prose prose-sm max-w-none">
      <h1>Mensalidades</h1>
      <p>
        O controle de mensalidades fica em <strong>Financeiro → aba Cobranças</strong>.
        Essa tela tem quatro sub-abas: <em>A Receber</em>, <em>Inadimplentes</em>,{' '}
        <em>Pagos</em> e <em>Por Morador</em>.
      </p>

      <h2>Registrar pagamento de uma mensalidade</h2>
      <ol>
        <li>Acesse <strong>Financeiro → Cobranças → A Receber</strong>.</li>
        <li>Localize o morador (use o campo de busca por nome ou rua).</li>
        <li>Toque em <strong>Pagar</strong> (botão verde) ao lado da parcela.</li>
        <li>
          Selecione a <strong>forma de pagamento</strong> (Dinheiro, PIX, Cheque, etc.).
          <ul>
            <li>Se for PIX: informe o nome do pagador.</li>
            <li>Se o pagamento for dividido em 2 formas: marque <em>"Pagamento dividido"</em> e preencha a segunda forma e valor.</li>
          </ul>
        </li>
        <li>Toque em <strong>Confirmar</strong>.</li>
      </ol>
      <p>
        O sistema imprime automaticamente o <strong>recibo</strong> (2 vias) e o <strong>carnê</strong> do morador.
      </p>

      <h2>Criar mensalidade manual (morador individual)</h2>
      <ol>
        <li>Em <strong>Financeiro → Cobranças</strong>, toque em <strong>+ Nova</strong> (borda azul tracejada).</li>
        <li>Busque e selecione o morador.</li>
        <li>Preencha: mês de referência, vencimento e valor.</li>
        <li>Toque em <strong>Criar</strong>.</li>
      </ol>

      <h2>Gerar mensalidades para todos os moradores (mês inteiro)</h2>
      <ol>
        <li>Em <strong>Financeiro → Cobranças</strong>, toque em <strong>+ Gerar Mês</strong> (borda verde tracejada).</li>
        <li>Selecione o mês, o dia de vencimento e o valor.</li>
        <li>Toque em <strong>Gerar Mensalidades</strong>.</li>
      </ol>
      <p>
        O sistema cria cobranças para todos os associados ativos que ainda não têm registro no mês selecionado.
      </p>

      <h2>Ver inadimplentes</h2>
      <p>
        Acesse a sub-aba <strong>Inadimplentes</strong>. Os moradores com parcelas
        vencidas aparecem em vermelho com o número de meses em atraso.
        Toque em <strong>Histórico</strong> para ver todas as mensalidades daquele morador.
      </p>

      <h2>Reimprimir carnê</h2>
      <ol>
        <li>Vá para a sub-aba <strong>Pagos</strong>.</li>
        <li>Selecione o mês desejado.</li>
        <li>Toque em <strong>Carnê</strong> ao lado do morador.</li>
      </ol>

      <p className="bg-amber-50 border border-amber-200 rounded-lg p-3 not-prose text-sm text-amber-700">
        ⚠️ O campo <strong>"Nome do operador"</strong> no topo da aba Cobranças define
        o nome que aparece no comprovante impresso. Preencha antes de registrar pagamentos.
      </p>

      <p className="mt-4">
        Veja também:{' '}
        <Link to="/help/nova-transacao">Lançar transação no caixa →</Link>
      </p>
    </article>
  )
}
