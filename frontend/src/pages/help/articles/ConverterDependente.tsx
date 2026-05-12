import { Link } from 'react-router-dom'

export default function ConverterDependente() {
  return (
    <article className="prose prose-sm max-w-none">
      <h1>Converter dependente em associado</h1>
      <p>
        Use a conversão quando um dependente passa a ser titular de uma unidade própria
        ou precisa ter status de associado independente.
      </p>

      <h2>Passo a passo</h2>
      <ol>
        <li>Acesse <strong>Moradores → aba Dependentes</strong>.</li>
        <li>Localize o dependente que deseja converter.</li>
        <li>Toque em <strong>🔄 Converter</strong> no card do dependente.</li>
        <li>
          No modal, selecione o <strong>tipo de destino</strong>:
          <ul>
            <li><em>Associado</em> — passa a ser membro titular com CPF obrigatório.</li>
            <li><em>Visitante</em> — cadastro simplificado sem vínculo.</li>
          </ul>
        </li>
        <li>Se necessário, selecione o <strong>novo responsável</strong> (para dependentes que ficam vinculados a outro titular).</li>
        <li>Toque em <strong>Converter</strong>.</li>
      </ol>

      <p>
        Após a conversão, o perfil aparece na aba correspondente (<em>Associados</em> ou <em>Visitantes</em>)
        com todo o histórico preservado.
      </p>

      <h2>Observações</h2>
      <ul>
        <li>Se o destino for <em>Associado</em>, o CPF se torna obrigatório. Certifique-se de que está preenchido antes de converter.</li>
        <li>A conversão não exclui o histórico de encomendas ou mensalidades vinculadas ao perfil.</li>
      </ul>

      <p>
        Precisa unificar dois cadastros duplicados?{' '}
        <Link to="/help/unificacao-cadastro">Veja como mesclar moradores →</Link>
      </p>
    </article>
  )
}
