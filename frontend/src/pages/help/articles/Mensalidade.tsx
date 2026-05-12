export default function Mensalidade() {
  return (
    <article className="prose prose-sm max-w-none">
      <h1>Lançar mensalidade</h1>
      <p>
        As mensalidades podem ser geradas em lote (para todos os moradores) ou individualmente.
      </p>

      <h2>Geração em lote</h2>
      <ol>
        <li>Acesse <strong>Financeiro → Cobranças</strong>.</li>
        <li>Toque em <strong>Gerar mensalidades</strong>.</li>
        <li>Selecione o mês de competência.</li>
        <li>Confirme — o sistema cria os lançamentos para todos os moradores ativos com o valor padrão da associação.</li>
      </ol>

      <h2>Lançamento individual</h2>
      <ol>
        <li>Acesse <strong>Moradores</strong> e abra o perfil do morador.</li>
        <li>Role até <strong>Mensalidades</strong> e toque em <strong>+ Lançar</strong>.</li>
        <li>Defina competência, valor e vencimento.</li>
        <li>Toque em <strong>Salvar</strong>.</li>
      </ol>

      <h2>Registrar pagamento</h2>
      <ol>
        <li>Na listagem de mensalidades pendentes, toque na parcela desejada.</li>
        <li>Toque em <strong>Registrar pagamento</strong>.</li>
        <li>Informe data de pagamento, valor pago e forma de pagamento.</li>
        <li>Confirme.</li>
      </ol>

      <h2>Inadimplência</h2>
      <p>
        O sistema marca automaticamente como <em>inadimplente</em> moradores com mensalidade
        vencida há mais de 30 dias. O status retorna a <em>ativo</em> assim que o pagamento
        for registrado.
      </p>
    </article>
  )
}
