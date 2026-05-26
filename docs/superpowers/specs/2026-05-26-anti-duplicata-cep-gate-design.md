# Anti-Duplicata: CEP Gate no Recebimento de Encomendas

**Data:** 2026-05-26  
**Módulo:** Logistics / Packages  
**Status:** Aprovado

---

## Problema

Operadores não encontram o cadastro existente do morador e criam duplicatas — às vezes como visitante (cobrando taxa indevida), às vezes duplicando um associado. A busca já existe mas não cria fricção suficiente para forçar uma segunda tentativa.

---

## Solução: Sequential Inline CEP Gate

Gate em duas camadas, inline no fluxo de recebimento. Nenhuma tela nova. Nenhum modal adicional.

---

## UX Flow

```
[Campo: Nome do morador]
        ↓ digita nome
[Lista de sugestões com score de similaridade]
        ↓ nenhum resultado serve → clica "Não encontrei"
[Campo: CEP da etiqueta]   [← Voltar]
        ↓ digita CEP (8 dígitos)
[ViaCEP lookup + busca de moradores na mesma rua — paralelas]
[Spinner bloqueia "Cadastrar novo" até resolução]
        ↓ se encontrou moradores na rua
[Lista: "Possíveis cadastros na mesma rua" → pode selecionar]
        ↓ se não encontrou (ou operador ignora lista)
[Botão "Cadastrar novo" desbloqueado]
```

---

## Arquitetura

### Frontend (`PackagesPage.tsx`)

**Novos estados:**
```ts
cepValue: string           // input do CEP
cepStreet: string          // logradouro retornado pelo ViaCEP
cepResidents: Resident[]   // moradores encontrados na mesma rua
cepLoading: boolean        // spinner ativo
cepDone: boolean           // busca concluída (libera "Cadastrar novo")
showCepGate: boolean       // gate visível (após "Não encontrei")
```

**Mudanças no painel de associação:**
- Botão "Visitante / Não associado" → substituído por "Não encontrei" (quando o operador decidiu que nenhum resultado serve)
- Após "Não encontrei": campo CEP inline + botão "← Voltar"
- "Cadastrar novo" só aparece quando `cepDone === true`
- Lista "Possíveis cadastros na mesma rua" exibida abaixo do campo CEP

**Debounce:** 400ms após último dígito do CEP para disparar lookup.

### Backend (`/residents/search`)

Parâmetro novo (opcional): `street: str | None = None`

Quando fornecido, adiciona filtro:
```sql
AND r.address ILIKE :street_pattern
```
onde `street_pattern = f"%{street}%"`.

Índice necessário: `CREATE INDEX IF NOT EXISTS idx_residents_address ON residents(association_id, address)`.

### Lookup ViaCEP

- URL: `https://viacep.com.br/ws/{cep}/json/`
- Timeout: 2s
- Em paralelo com busca de moradores (se `cepStreet` já disponível do estado anterior, reutiliza)
- Se ViaCEP falhar: busca só por nome, `cepDone = true` imediatamente

---

## Data Flow

```
[1] operador digita CEP
[2] debounce 400ms
[3] fetch ViaCEP → extrai `logradouro`
[4] em paralelo → GET /residents/search?q={nome}&street={logradouro}
[5] backend filtra: full_name ILIKE %nome% AND address ILIKE %logradouro%
[6] resultado em < 300ms
[7] frontend exibe lista ou desbloqueia "Cadastrar novo"
```

---

## Tratamento de Erros

| Cenário | Comportamento |
|---|---|
| CEP < 8 dígitos | Campo vermelho, nenhuma busca dispara |
| ViaCEP erro / timeout (2s) | Pula lookup de rua; busca só por nome; `cepDone = true` |
| Morador sem `address` no cadastro | Não aparece na busca por rua (ILIKE só retorna quem tem endereço preenchido) |
| Operador ignora lista de sugestões | Pode clicar "Cadastrar novo" — sistema sinalizou, não bloqueou |
| 0 resultados na busca por rua | `cepDone = true` imediatamente, "Cadastrar novo" desbloqueado |
| Clique em "← Voltar" | Limpa `cepValue`, `cepStreet`, `cepResidents`, `showCepGate = false` |

---

## Fora de Escopo

- Não altera o fluxo de criação do cadastro em si
- Não valida CEP contra endereço do morador existente
- Não bloqueia criação se operador insistir — apenas sinaliza
- Não muda o fluxo de busca por nome (que já existe)
