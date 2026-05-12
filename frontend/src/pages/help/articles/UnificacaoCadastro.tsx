import { Link } from 'react-router-dom'
import { ArticleWrapper } from './ArticleWrapper'

export default function UnificacaoCadastro() {
  return (
    <ArticleWrapper>
      <h1>Unificar cadastros (Mesclar moradores)</h1>
      <p>
        Use a mesclagem quando um morador foi cadastrado mais de uma vez.
        O processo une os registros, transferindo todo o histórico para o perfil principal.
      </p>

      <h2>Quando usar</h2>
      <ul>
        <li>O mesmo morador aparece duplicado na listagem.</li>
        <li>Encomendas ou mensalidades estão divididas entre dois perfis.</li>
        <li>Houve erro de digitação no CPF ou nome ao cadastrar.</li>
      </ul>

      <h2>Passo a passo</h2>
      <ol>
        <li>Acesse <strong>Moradores → aba Associados</strong>.</li>
        <li>Toque em <strong>Mesclar</strong> (botão no topo da tela). Checkboxes aparecem em cada card.</li>
        <li>Marque os <strong>dois moradores</strong> que deseja unificar.</li>
        <li>Toque em <strong>Confirmar Mesclagem</strong>.</li>
        <li>No modal, escolha qual perfil será o <strong>principal</strong> (os dados desse perfil serão mantidos).</li>
        <li>Toque em <strong>Mesclar</strong>.</li>
      </ol>

      <h2>O que acontece após a mesclagem</h2>
      <ul>
        <li>Todo o histórico (encomendas, mensalidades, ordens de serviço) é transferido para o perfil principal.</li>
        <li>O perfil secundário é desativado e seus registros passam a aparecer como dependentes do principal.</li>
        <li>A operação fica registrada no log do sistema com o usuário responsável.</li>
      </ul>

      <p className="bg-amber-50 border border-amber-200 rounded-lg p-3 not-prose text-sm text-amber-700">
        ⚠️ <strong>Atenção:</strong> a mesclagem não pode ser desfeita. Revise os dois perfis antes de confirmar.
      </p>

      <p className="mt-4">
        Precisa converter um dependente em associado?{' '}
        <Link to="/help/converter-dependente">Veja como converter →</Link>
      </p>
    </ArticleWrapper>
  )
}
