# Simplifica — Padrões de Implementação

## Conceito

O Modo Simplifica é uma interface mobile-first com tiles (grade 2×N) como navegação.
O operacional **é idêntico ao sistema original** — apenas a navegação muda.

---

## Padrão: Modal Suspenso (overlay no Simplifica)

Quando uma operação tem seu formulário **embutido em uma página full-system** (ex: PackagesPage),
usamos o padrão de "modal suspenso":

1. A página full-system é montada num container off-screen:
   ```tsx
   <div style={{ position: 'fixed', left: '-99999px', width: '1px', height: '1px', overflow: 'hidden' }}>
     <PackagesPage modalMode={true} onModalClosed={() => setAtivo(false)} />
   </div>
   ```
2. Os modais internos usam `fixed inset-0 z-50` — pelo CSS spec, `fixed` é relativo ao viewport,
   **escapam do container off-screen e aparecem suspensos sobre o Simplifica**.
3. Quando o modal fecha, `onModalClosed` é chamado → desmonta o componente.

**Resultado:** usuário permanece na rota `/simplifica/...` durante toda a operação.

### Comparação com TransactionModal (padrão Caixa)

| Operação | Componente | Técnica |
|---|---|---|
| Mensalidades | `TransactionModal` (standalone) | Renderizado direto no SimplificaCaixa |
| Comp. Residência | `TransactionModal` (standalone) | Renderizado direto no SimplificaCaixa |
| Registrar Saída | `SangriaModal` (standalone) | Renderizado direto no SimplificaCaixa |
| Receber Encomenda | `PackagesPage` (embedded) | Off-screen container + `modalMode` |
| Retirada | `PackagesPage` (embedded) | Off-screen container + `retiradaMode` |
| Devolução | `PackagesPage` (embedded) | Off-screen container + `devolucaoMode` |

---

## Props de Modo no PackagesPage

```tsx
interface PackagesPageProps {
  modalMode?: boolean      // Receber — abre seletor unitário/múltiplo
  retiradaMode?: boolean   // Retirada — abre picker de encomendas pendentes
  devolucaoMode?: boolean  // Devolução — abre picker + detail modal c/ devolução
  onModalClosed?: () => void  // callback quando todos os modais do modo fecham
}
```

Quando `modalMode/retiradaMode/devolucaoMode = true`:
- Suprime `loadPackages` e `loadReceiveHistory` (zero API desnecessária)
- Auto-abre o modal/picker correspondente
- `onModalClosed` é chamado ao fechar

---

## Quando navegar vs quando usar modal suspenso

| Caso | Decisão |
|---|---|
| Formulário é componente standalone (ex: TransactionModal) | Renderizar direto na página Simplifica |
| Formulário está embutido em full-page (ex: PackagesPage) | Off-screen container com modo prop |
| Operação não tem formulário próprio (lista/consulta) | Navegar para a rota original (`/packages`, etc.) |

---

## Estrutura de Arquivos

```
pages/simplifica/
  SimplificaHome.tsx          — grade principal (6 setores)
  SimplificaLayout.tsx        — guard de rota + layout base
  SimplificaConfig.tsx        — configurações (fonte, tema, voltar)
  SimplificaChat.tsx          — chat direto
  SimplificaCaixa.tsx         — caixa (usa TransactionModal/SangriaModal inline)
  SimplificaEncomendas.tsx    — encomendas (orquestra PackagesPage em modo)
  SimplificaMoradores.tsx     — moradores (navegação + telas inline futuras)
  SimplificaOrdens.tsx        — ordens (navegação + telas inline futuras)
  theme.ts                    — SECTOR_COLORS por setor
  components/
    SimplificaHeader.tsx      — header com voltar + brand-header color
    SimplificaTile.tsx        — tile com LucideIcon, cor por setor, layout assimétrico
    SimplificaBottomSheet.tsx — bottom sheet genérico
```

---

## Cores por Setor

```ts
SECTOR_COLORS = {
  caixa:      '#0f7a4d',  // verde
  encomendas: '#c2620a',  // âmbar
  moradores:  '#1a3f6f',  // azul (brand)
  ordens:     '#6d28d9',  // roxo
  chat:       '#0d7490',  // teal
  config:     '#475569',  // slate
}
```

---

## SimplificaTile

```tsx
<SimplificaTile
  icon={LucideIconComponent}   // ícone lucide-react (NÃO emoji)
  label="Label"
  color={SECTOR_COLORS.setor}
  onClick={handler}
  badge="3"                    // opcional — badge vermelho
/>
```

Layout: ícone (w-12 h-12, chip com tint 12%) no topo-esquerda, label na base-esquerda.
Sem ícones emoji — todos lucide-react para consistência cross-platform.
