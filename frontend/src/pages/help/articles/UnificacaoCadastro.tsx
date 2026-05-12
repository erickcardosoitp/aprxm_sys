import { Link } from 'react-router-dom'

export default function UnificacaoCadastro() {
  return (
    <article className="prose prose-sm max-w-none">
      <h1>Unificar cadastros</h1>
      <p>
        Use a unificação quando um mesmo morador possui <strong>dois cadastros diferentes</strong>{' '}
        no sistema (por exemplo, criado duas vezes por engano). O processo mescla os dados
        mantendo o histórico completo.
      </p>

      <h2>Quando usar</h2>
      <ul>
        <li>Morador aparece duplicado na listagem.</li>
        <li>Encomendas e mensalidades estão divididas entre dois perfis.</li>
        <li>Morador tem dois CPFs cadastrados por erro de digitação.</li>
      </ul>

      <h2>Passo a passo</h2>
      <ol>
        <li>Acesse <strong>Moradores</strong> e localize o perfil que será <em>mantido</em> (principal).</li>
        <li>Abra o perfil e toque em <strong>⋯ Mais opções → Unificar com outro cadastro</strong>.</li>
        <li>Busque e selecione o perfil <em>duplicado</em> (que será removido).</li>
        <li>
          Revise o resumo: o sistema mostrará quais dados de cada perfil serão preservados.
          Por padrão, mantém os dados do perfil principal.
        </li>
        <li>Toque em <strong>Confirmar unificação</strong>.</li>
      </ol>

      <h2>O que acontece após a unificação</h2>
      <ul>
        <li>Todo o histórico de encomendas, mensalidades e ordens de serviço é transferido para o perfil principal.</li>
        <li>O perfil duplicado é desativado (soft delete) — não é excluído permanentemente.</li>
        <li>A operação é registrada no log do sistema com o usuário responsável.</li>
      </ul>

      <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 not-prose text-sm">
        ⚠️ <strong>Atenção:</strong> a unificação não pode ser desfeita. Confirme que selecionou
        os perfis corretos antes de prosseguir.
      </p>

      <p className="mt-4">
        Dúvidas sobre o perfil do morador?{' '}
        <Link to="/help/cadastrar-morador">Veja como cadastrar um morador →</Link>
      </p>
    </article>
  )
}
