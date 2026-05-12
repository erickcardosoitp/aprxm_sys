import { Link } from 'react-router-dom'

export default function CadastrarMorador() {
  return (
    <article className="prose prose-sm max-w-none">
      <h1>Cadastrar morador</h1>
      <p>
        O cadastro de morador registra o titular da unidade. Existem dois tipos:{' '}
        <strong>Membro</strong> (associado regular, requer CPF) e <strong>Visitante</strong>{' '}
        (cadastro simplificado).
      </p>

      <h2>Passo a passo</h2>
      <ol>
        <li>Acesse o menu <strong>Moradores</strong>.</li>
        <li>Toque em <strong>+ Novo morador</strong>.</li>
        <li>Preencha nome completo, unidade/apartamento e tipo (<em>Membro</em> ou <em>Visitante</em>).</li>
        <li>
          Se for <strong>Membro</strong>: informe o CPF (obrigatório), data de nascimento e contato.
        </li>
        <li>Defina o <strong>dia de vencimento</strong> da mensalidade ou deixe em branco para usar o padrão da associação.</li>
        <li>Toque em <strong>Salvar</strong>.</li>
      </ol>

      <h2>Status do morador</h2>
      <ul>
        <li><strong>Ativo</strong> — elegível a todos os serviços sem taxa extra.</li>
        <li><strong>Inadimplente</strong> — ainda ativo, mas com mensalidade em atraso.</li>
        <li><strong>Suspenso</strong> — bloqueado; aparece em vermelho nos relatórios.</li>
      </ul>

      <p>
        Após o cadastro, você pode{' '}
        <Link to="/help/cadastrar-dependente">adicionar dependentes →</Link>
      </p>
    </article>
  )
}
