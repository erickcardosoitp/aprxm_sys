import { Link } from 'react-router-dom'

export default function EncomendasMultiplo() {
  return (
    <article className="prose prose-sm max-w-none">
      <h1>Receber encomendas (múltiplo)</h1>
      <p>
        Use este fluxo quando chegar um <strong>lote de volumes</strong> ao mesmo tempo — por exemplo,
        entrega de transportadora com vários pacotes.
      </p>

      <h2>Passo a passo</h2>
      <ol>
        <li>Acesse o menu <strong>Encomendas</strong>.</li>
        <li>Toque em <strong>+ Receber</strong> e selecione a aba <strong>Múltiplos</strong>.</li>
        <li>Escaneie ou digite o código do primeiro volume e pressione <strong>Adicionar</strong>.</li>
        <li>Repita o processo para cada volume do lote.</li>
        <li>Ao finalizar a leitura, toque em <strong>Confirmar lote</strong>.</li>
        <li>
          O sistema exibirá um resumo com todos os volumes. Confirme para registrar
          e disparar as notificações em massa.
        </li>
      </ol>

      <h2>Dicas</h2>
      <ul>
        <li>Você pode remover um item do lote antes de confirmar tocando no ícone de lixeira ao lado do código.</li>
        <li>Encomendas sem destinatário identificado ficam em <em>Sem morador</em> — edite-as depois na listagem.</li>
        <li>A taxa de R$ 2,50 para não-membros é aplicada individualmente por volume.</li>
      </ul>

      <p>
        Para um único volume, use o{' '}
        <Link to="/help/encomendas-unitario">fluxo unitário →</Link>
      </p>
    </article>
  )
}
