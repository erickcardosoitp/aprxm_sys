import { ArticleWrapper } from './ArticleWrapper'

export default function CriarOS() {
  return (
    <ArticleWrapper>
      <h1>Criar Ordem de Serviço (OS)</h1>
      <p>
        Ordens de Serviço registram problemas, solicitações de reparo ou demandas da comunidade.
        Acesse em <strong>Ordens</strong> no menu de navegação.
      </p>

      <h2>Criar nova OS</h2>
      <ol>
        <li>Toque em <strong>+ Nova OS</strong>.</li>
        <li>
          Preencha as seções do formulário:
          <ul>
            <li><strong>Título</strong> — descreva o problema resumidamente (ex: "Vazamento na cozinha do bloco A").</li>
            <li><strong>Descrição</strong> — detalhe o que está ocorrendo.</li>
            <li><strong>Unidade/Bloco</strong> — ex: "203" ou "A-15".</li>
            <li><strong>Prioridade</strong> — Baixa, Média, Alta ou Crítica.</li>
            <li><strong>Categoria</strong> — Hidráulica, Elétrica, etc.</li>
            <li><strong>Solicitante</strong> — busque o morador que reportou o problema.</li>
            <li><strong>Responsável</strong> — usuário da equipe que irá atender.</li>
          </ul>
        </li>
        <li>Toque em <strong>Criar</strong>.</li>
      </ol>
      <p>
        A OS é criada com status <em>Rascunho</em> e aparece no board (Kanban).
      </p>

      <h2>Acompanhar e atualizar status</h2>
      <p>O fluxo de status é:</p>
      <p className="not-prose text-sm font-mono bg-gray-50 border border-gray-200 rounded-lg p-3">
        Rascunho → Pendente → Aberta → Em Andamento → Ag. Terceiros → Concluída → Arquivada
      </p>
      <ol>
        <li>No board Kanban, arraste o card para a próxima coluna.</li>
        <li>Ou abra a OS e toque no <strong>badge de status</strong> para selecionar o novo status.</li>
        <li>Se estiver concluindo: preencha as <strong>notas de resolução</strong>.</li>
        <li>Toque em <strong>Confirmar</strong>.</li>
      </ol>

      <h2>Adicionar tarefas (demandas)</h2>
      <ol>
        <li>Abra a OS e acesse a aba <strong>Demandas</strong>.</li>
        <li>Toque em <strong>+ Adicionar Demanda</strong>.</li>
        <li>Preencha título, prioridade, status e responsável.</li>
        <li>Opcionalmente adicione um <strong>checklist</strong> de itens e <strong>anexos</strong>.</li>
        <li>Toque em <strong>Criar Demanda</strong>.</li>
      </ol>

      <h2>Adicionar comentários</h2>
      <ol>
        <li>Abra a OS e acesse a aba <strong>Comentários</strong>.</li>
        <li>Digite o comentário e toque em <strong>💬 Comentar</strong>.</li>
        <li>Você pode anexar fotos ou documentos junto ao comentário.</li>
      </ol>

      <h2>Filtrar e buscar OS</h2>
      <ul>
        <li>Use o campo de busca para filtrar por número, título ou morador.</li>
        <li>Use os filtros de <strong>status</strong> e <strong>prioridade</strong> para refinar a listagem.</li>
        <li>Alterne entre a vista <strong>Board</strong> (Kanban) e <strong>Lista</strong> conforme preferir.</li>
      </ul>
    </ArticleWrapper>
  )
}
