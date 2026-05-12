import { Link } from 'react-router-dom'

export default function CadastrarDependente() {
  return (
    <article className="prose prose-sm max-w-none">
      <h1>Cadastrar dependente</h1>
      <p>
        Dependentes são vinculados a um morador titular. Eles compartilham a unidade e
        herdam o status de elegibilidade do titular.
      </p>

      <h2>Passo a passo</h2>
      <ol>
        <li>Acesse o menu <strong>Moradores</strong> e localize o titular.</li>
        <li>Abra o perfil do morador tocando em seu nome.</li>
        <li>Role até a seção <strong>Dependentes</strong> e toque em <strong>+ Adicionar dependente</strong>.</li>
        <li>Preencha nome, parentesco e data de nascimento.</li>
        <li>Toque em <strong>Salvar</strong>.</li>
      </ol>

      <h2>Observações</h2>
      <ul>
        <li>Dependentes não possuem login próprio no sistema.</li>
        <li>A taxa de encomenda para dependentes segue o status do titular.</li>
        <li>
          Se o titular for suspenso, os dependentes também ficam sem acesso a benefícios.
        </li>
      </ul>

      <p>
        Ainda não cadastrou o titular?{' '}
        <Link to="/help/cadastrar-morador">Veja como cadastrar um morador →</Link>
      </p>
    </article>
  )
}
