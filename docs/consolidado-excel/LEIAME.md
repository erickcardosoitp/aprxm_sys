# Consolidado Executivo APRXM — Instalação e Uso

## Pré-requisitos

1. **Driver ODBC PostgreSQL Unicode** instalado no Windows:
   - Download: https://www.postgresql.org/ftp/odbc/versions/msi/
   - Instalar a versão mais recente (x64)
   - Verificar em Painel de Controle → Fontes de Dados ODBC (64 bits) → Drivers

2. **Microsoft Excel** (versão 2016 ou superior)

---

## Instalação dos módulos VBA

### Passo 1 — Criar o arquivo Excel

1. Abra o Excel e crie um novo arquivo `.xlsm` (macro-habilitado)
2. Salve como `APRXM_Consolidado.xlsm`

### Passo 2 — Importar os módulos

1. Pressione `Alt+F11` para abrir o VBA Editor
2. No menu: **Arquivo → Importar Arquivo** (ou clique com o direito na pasta "Módulos")
3. Importe nesta ordem:
   - `mdl_DADOS.bas`
   - `mdl_Inicio.bas`
   - `mdl_Presidencia.bas`
   - `mdl_Financeiro.bas`
   - `mdl_Moradores.bas`
   - `mdl_Mensalidades.bas`
   - `mdl_Pacotes.bas`
   - `mdl_OS.bas`
   - `mdl_Senso.bas`
   - `mdl_Main.bas`

### Passo 3 — Ativar referências ADODB

No VBA Editor: **Ferramentas → Referências**
Marque:
- ✅ Microsoft ActiveX Data Objects 6.1 Library

### Passo 4 — Criar a estrutura de abas

1. No VBA Editor, pressione `F5` ou vá em **Executar → Executar Sub/Função**
2. Execute: `mdl_Main.SetupWorkbook`
3. Isso cria todas as 8 abas e a aba `_DADOS` oculta

---

## Uso diário

### Opção A: Atualizar tudo (banco + telas)

1. No VBA Editor, descomente estas 2 linhas em `mdl_DADOS.RefreshAllData`:
   ```vba
   ' wsDados.Visible = xlSheetVisible      → descomente
   ' wsDados.Visible = xlSheetVeryHidden   → descomente
   ```
2. Execute `mdl_DADOS.RefreshAllData` (`Alt+F8`)
3. Execute `mdl_Main.PopulateAll` (`Alt+F8`)
4. Recomente as linhas

### Opção B: Apenas re-renderizar (sem buscar novos dados)

Execute apenas `mdl_Main.PopulateAll` — usa os dados já em `_DADOS`.

---

## Connection String

A connection string está pré-configurada em `mdl_Main.SetupWorkbook` e copiada para `_DADOS!B1`.  
Caso precise alterar, edite diretamente a célula `_DADOS!B1` (tornar a aba visível temporariamente via VBA).

```
Driver={PostgreSQL Unicode};Server=ep-floral-shadow-ap9n86vs.c-7.us-east-1.aws.neon.tech;Port=5432;Database=neondb;Uid=neondb_owner;Pwd=npg_M2hLclCBG1XD;SSLmode=require;
```

---

## Estrutura das abas

| Aba | Pergunta-guia |
|-----|---------------|
| INÍCIO | Em uma linha, qual é a saúde da associação hoje? |
| PRESIDÊNCIA | Como está a saúde geral da associação esta semana? |
| FINANCEIRO | Quanto arrecadamos e de onde vem o dinheiro? |
| MORADORES | Quem mora aqui e qual é o perfil da comunidade? |
| MENSALIDADES | Quantos moradores pagam em dia? Onde está a inadimplência? |
| PACOTES | Quantos pacotes estão parados? Qual é o SLA de entrega? |
| OS | Quem é o colaborador mais produtivo esta semana? |
| SENSO | O que a comunidade está sentindo? |

---

## Paleta visual

- `#0D2137` Navy — cabeçalhos principais
- `#0891B2` Cerulean — sub-cabeçalhos, destaques
- `#F59E0B` Amber — alertas, atenção

---

## Cobertura dos dados

Os dados cobrem de **março/2026 até hoje** (ETL roda às 09h e 17h Brasília).  
Tabelas carregadas do Neon Analytics (`aprxm-analytics`): 18 tabelas gold.
