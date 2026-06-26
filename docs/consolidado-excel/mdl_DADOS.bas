Attribute VB_Name = "mdl_DADOS"
'=============================================================================
' APRXM Aproxima — Consolidado Executivo
' Associação de Moradores Sapê-Vaz Lobo e Buriti-Congonha
'
' Módulo: mdl_DADOS
' Responsabilidade: Conectar ao Neon Analytics DB e preencher aba _DADOS
'
' IMPORTANTE: Todas as queries usam aliases SQL para produzir os nomes de
'             colunas que os módulos VBA esperam. Não altere os aliases
'             sem atualizar os módulos correspondentes.
'
' Pré-requisito: driver ODBC PostgreSQL Unicode
'   https://www.postgresql.org/ftp/odbc/versions/msi/
'=============================================================================
Option Explicit

Private Const SHEET_DADOS As String = "_DADOS"
Private Const CONN_CELL    As String = "B1"

'=============================================================================
' SUB PRINCIPAL — executar via Alt+F8 > RefreshAllData
'=============================================================================
Public Sub RefreshAllData()
    Dim wsDados As Worksheet
    Dim conn    As Object
    Dim t0      As Single

    t0 = Timer
    On Error GoTo ErrHandler

    Set wsDados = GetOrCreateSheet(SHEET_DADOS)

    ' Descomente para tornar _DADOS visível durante o refresh:
    ' wsDados.Visible = xlSheetVisible

    Dim connStr As String
    connStr = wsDados.Range(CONN_CELL).Value
    If Len(Trim(connStr)) = 0 Then
        MsgBox "Connection string não configurada em _DADOS!" & CONN_CELL, vbCritical
        Exit Sub
    End If

    Set conn = CreateObject("ADODB.Connection")
    conn.ConnectionTimeout = 30
    conn.CommandTimeout = 120
    conn.Open connStr

    Application.StatusBar = "APRXM: carregando financeiro..."
    Call LoadTable(conn, wsDados, "RECEITA_DIARIA",    SQL_ReceitaDiaria())
    Call LoadTable(conn, wsDados, "RECEITA_OP_TIPO",   SQL_ReceitaOpTipo())
    Call LoadTable(conn, wsDados, "TAXA_COBRANCA",     SQL_TaxaCobranca())
    Call LoadTable(conn, wsDados, "COBRANCA_RUA",      SQL_CobrancaRua())
    Call LoadTable(conn, wsDados, "RUNWAY",            SQL_Runway())

    Application.StatusBar = "APRXM: carregando inadimplência..."
    Call LoadTable(conn, wsDados, "INADIMPLENCIA",     SQL_InadimplenciaAgg())
    Call LoadTable(conn, wsDados, "INADIMPL_PESSOAS",  SQL_InadimplenciaPessoas())

    Application.StatusBar = "APRXM: carregando moradores..."
    Call LoadTable(conn, wsDados, "MORADORES_GERAL",   SQL_MoradoresGeral())
    Call LoadTable(conn, wsDados, "CRESCIMENTO",       SQL_Crescimento())
    Call LoadTable(conn, wsDados, "CENSO_RUA",         SQL_CensoRua())
    Call LoadTable(conn, wsDados, "PROBLEMAS",         SQL_Problemas())

    Application.StatusBar = "APRXM: carregando pacotes..."
    Call LoadTable(conn, wsDados, "PACOTES_STUCK",     SQL_PacotesStuck())
    Call LoadTable(conn, wsDados, "SLA_TIPO",          SQL_SlaTipo())
    Call LoadTable(conn, wsDados, "RANK_MORADORES",    SQL_RankMoradores())
    Call LoadTable(conn, wsDados, "OP_PERFORMANCE",    SQL_OpPerformance())

    Application.StatusBar = "APRXM: carregando equipe..."
    Call LoadTable(conn, wsDados, "TAREFAS_SEMANA",    SQL_TarefasSemana())
    Call LoadTable(conn, wsDados, "RANK_COLAB",        SQL_RankColab())
    Call LoadTable(conn, wsDados, "KPI_OP",            SQL_KpiOp())
    Call LoadTable(conn, wsDados, "QUEBRAS_CAIXA",     SQL_QuebrasCaixa())

    Application.StatusBar = "APRXM: calculando médias móveis..."
    Call CalcMovingAverage(wsDados)

    Call StampTimestamp()

    conn.Close
    Set conn = Nothing

    ' Descomente para re-ocultar após o refresh:
    ' wsDados.Visible = xlSheetVeryHidden

    Application.StatusBar = False
    MsgBox "Dados atualizados em " & Format(Now, "dd/mm/yyyy hh:mm") & _
           " (" & Format(Timer - t0, "0.0") & "s)", vbInformation, "APRXM Aproxima"
    Exit Sub

ErrHandler:
    If Not conn Is Nothing Then
        If conn.State = 1 Then conn.Close
    End If
    Application.StatusBar = False
    MsgBox "Erro ao carregar dados:" & vbCrLf & Err.Description, vbCritical, "APRXM — Erro"
End Sub


'=============================================================================
' QUERIES SQL — cada função retorna a query com aliases que o VBA espera
' Regra: colunas produzidas AQUI = colunas lidas nos módulos de aba
'=============================================================================

Private Function SQL_ReceitaDiaria() As String
    ' Converte month/week para string ISO para comparação no VBA
    SQL_ReceitaDiaria = _
        "SELECT " & _
        "  TO_CHAR(date,  'YYYY-MM-DD') AS date, " & _
        "  TO_CHAR(week,  'YYYY-MM-DD') AS week, " & _
        "  TO_CHAR(month, 'YYYY-MM')    AS month, " & _
        "  association_id, association_name, " & _
        "  total_income, total_expense, " & _
        "  mensalidade, delivery_fee, proof_of_residence, " & _
        "  other_income, sangria_total, net, " & _
        "  income_count, expense_count " & _
        "FROM daily_revenue " & _
        "ORDER BY date DESC"
End Function

Private Function SQL_ReceitaOpTipo() As String
    ' receita_por_operador_tipo só existe após deploy do ETL.
    ' Enquanto não existe, faz fallback em operator_revenue com zeros nos breakdown.
    ' Após deploy, trocar pelo bloco comentado abaixo.
    Dim tblExiste As Boolean
    tblExiste = TableExists("receita_por_operador_tipo")

    If tblExiste Then
        SQL_ReceitaOpTipo = _
            "SELECT " & _
            "  created_by_name, association_id, association_name, " & _
            "  TO_CHAR(week, 'YYYY-MM-DD') AS week, " & _
            "  TO_CHAR(month, 'YYYY-MM')   AS month, " & _
            "  mensalidade, delivery_fee, proof_of_residence, other_income, " & _
            "  total, n_transacoes " & _
            "FROM receita_por_operador_tipo " & _
            "ORDER BY week DESC, total DESC"
    Else
        ' Fallback: operator_revenue (sem breakdown por subtipo)
        SQL_ReceitaOpTipo = _
            "SELECT " & _
            "  created_by_name, association_id, association_name, " & _
            "  TO_CHAR(week, 'YYYY-MM-DD') AS week, " & _
            "  NULL::text  AS month, " & _
            "  0::float AS mensalidade, " & _
            "  0::float AS delivery_fee, " & _
            "  0::float AS proof_of_residence, " & _
            "  0::float AS other_income, " & _
            "  receita   AS total, " & _
            "  n_transacoes " & _
            "FROM operator_revenue " & _
            "ORDER BY week DESC, receita DESC"
    End If
End Function

Private Function SQL_TaxaCobranca() As String
    ' Renomeia colunas + converte month para string
    SQL_TaxaCobranca = _
        "SELECT " & _
        "  TO_CHAR(month, 'YYYY-MM') AS month, " & _
        "  association_id, " & _
        "  total                     AS total_gerado, " & _
        "  paid                      AS total_pago, " & _
        "  total - paid              AS pendentes, " & _
        "  0                         AS vencidas, " & _
        "  valor_total, valor_pago, " & _
        "  taxa_pct                  AS pct_paid " & _
        "FROM collection_rate " & _
        "ORDER BY month DESC"
End Function

Private Function SQL_CobrancaRua() As String
    ' cobranca_por_rua só existe após deploy do ETL.
    ' Fallback: dados vazios com estrutura correta.
    If TableExists("cobranca_por_rua") Then
        SQL_CobrancaRua = _
            "SELECT " & _
            "  street, " & _
            "  TO_CHAR(month, 'YYYY-MM') AS month, " & _
            "  association_id, association_name, " & _
            "  total, pagas, pendentes, vencidas, acordos, " & _
            "  valor_total, valor_pago, taxa_pct " & _
            "FROM cobranca_por_rua " & _
            "ORDER BY month DESC, valor_total DESC"
    Else
        SQL_CobrancaRua = _
            "SELECT " & _
            "  'Aguardando ETL' AS street, " & _
            "  TO_CHAR(CURRENT_DATE, 'YYYY-MM') AS month, " & _
            "  NULL AS association_id, NULL AS association_name, " & _
            "  0 AS total, 0 AS pagas, 0 AS pendentes, 0 AS vencidas, " & _
            "  0 AS acordos, 0 AS valor_total, 0 AS valor_pago, " & _
            "  0::float AS taxa_pct " & _
            "WHERE 1=0"
    End If
End Function

Private Function SQL_Runway() As String
    ' runway_semanas / 4.33 = meses; adapta nomes para VBA
    SQL_Runway = _
        "SELECT " & _
        "  association_id, association_name, " & _
        "  saldo_atual                          AS current_balance, " & _
        "  ROUND((despesa_media_semanal * 4.33)::numeric, 2) AS avg_monthly_expense, " & _
        "  ROUND((receita_media_semanal * 4.33)::numeric, 2) AS avg_monthly_revenue, " & _
        "  ROUND((runway_semanas / 4.33)::numeric, 1)        AS months_of_runway, " & _
        "  situacao " & _
        "FROM runway"
End Function

Private Function SQL_InadimplenciaAgg() As String
    ' Agrega delinquency_report + collection_rate para produzir KPIs de mensalidades.
    ' delinquency_report = pessoas com overdue_months > 0 (já vencidas).
    ' collection_rate    = totais de cobrança por mês.
    ' Usamos o mês mais recente de collection_rate para paid/total.
    SQL_InadimplenciaAgg = _
        "WITH cr AS ( " & _
        "  SELECT association_id, " & _
        "    SUM(paid)         AS pagas, " & _
        "    SUM(total - paid) AS pendentes, " & _
        "    SUM(valor_total)  AS valor_total, " & _
        "    SUM(valor_pago)   AS valor_pago " & _
        "  FROM collection_rate " & _
        "  WHERE month >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' " & _
        "  GROUP BY association_id " & _
        "), dr AS ( " & _
        "  SELECT association_id, association_name, " & _
        "    COUNT(*)       AS vencidas, " & _
        "    SUM(total_owed) AS total_owed " & _
        "  FROM delinquency_report " & _
        "  GROUP BY association_id, association_name " & _
        ") " & _
        "SELECT " & _
        "  dr.association_id, dr.association_name, " & _
        "  COALESCE(cr.pagas, 0)::int     AS pagas, " & _
        "  COALESCE(cr.pendentes, 0)::int AS pendentes, " & _
        "  COALESCE(dr.vencidas, 0)::int  AS vencidas, " & _
        "  0 AS acordos, 0 AS isentas, " & _
        "  COALESCE(cr.valor_pago, 0)     AS valor_pago, " & _
        "  COALESCE(cr.valor_total, 0)    AS valor_total, " & _
        "  COALESCE(dr.total_owed, 0)     AS total_owed " & _
        "FROM dr LEFT JOIN cr ON dr.association_id = cr.association_id"
End Function

Private Function SQL_InadimplenciaPessoas() As String
    ' Lista de pessoas inadimplentes para o ranking "Maiores Devedores"
    SQL_InadimplenciaPessoas = _
        "SELECT " & _
        "  full_name         AS resident_name, " & _
        "  phone_primary, type, address_street, " & _
        "  association_id, association_name, " & _
        "  overdue_months    AS months_overdue, " & _
        "  total_owed        AS valor_devido, " & _
        "  total_owed " & _
        "FROM delinquency_report " & _
        "ORDER BY total_owed DESC"
End Function

Private Function SQL_MoradoresGeral() As String
    SQL_MoradoresGeral = _
        "SELECT " & _
        "  association_id, association_name, " & _
        "  total_ativos   AS total, " & _
        "  members, guests, dependents, " & _
        "  confirmed, sem_internet, " & _
        "  novos_semana   AS active_7d, " & _
        "  novos_mes      AS active_30d, " & _
        "  0              AS delinquent " & _
        "FROM resident_overview"
End Function

Private Function SQL_Crescimento() As String
    ' member_growth_weekly tem uma linha por (week, type).
    ' Agrega para obter totais semanais com new_members, net_new, cumulative.
    SQL_Crescimento = _
        "SELECT " & _
        "  TO_CHAR(week, 'YYYY-MM-DD')     AS week, " & _
        "  association_id, association_name, " & _
        "  SUM(novos)                       AS new_members, " & _
        "  SUM(CASE WHEN type = 'member' THEN novos ELSE 0 END) AS novos_associados, " & _
        "  0 AS churned, " & _
        "  SUM(novos)  AS net_new, " & _
        "  SUM(SUM(novos)) OVER ( " & _
        "    PARTITION BY association_id " & _
        "    ORDER BY week ROWS UNBOUNDED PRECEDING " & _
        "  ) AS cumulative_total " & _
        "FROM member_growth_weekly " & _
        "GROUP BY week, association_id, association_name " & _
        "ORDER BY week DESC"
End Function

Private Function SQL_CensoRua() As String
    SQL_CensoRua = _
        "SELECT " & _
        "  street, association_id, association_name, " & _
        "  total, " & _
        "  associados   AS members, " & _
        "  visitantes   AS guests, " & _
        "  com_pragas, sem_internet, com_problemas, " & _
        "  CASE WHEN total > 0 " & _
        "    THEN ROUND((associados::numeric / total * 100), 1) " & _
        "    ELSE 0 END AS pct_members " & _
        "FROM census_by_street " & _
        "ORDER BY total DESC"
End Function

Private Function SQL_Problemas() As String
    SQL_Problemas = _
        "SELECT " & _
        "  problem       AS problem_type, " & _
        "  association_id, association_name, " & _
        "  ocorrencias, associados, visitantes, " & _
        "  NULL          AS last_seen, " & _
        "  'aberto'      AS status " & _
        "FROM community_problems " & _
        "ORDER BY ocorrencias DESC"
End Function

Private Function SQL_PacotesStuck() As String
    SQL_PacotesStuck = _
        "SELECT " & _
        "  association_id, " & _
        "  paradas_3d    AS total, " & _
        "  paradas_3d    AS stuck_3d, " & _
        "  paradas_7d, " & _
        "  paradas_3d    AS total_waiting, " & _
        "  0             AS delivered_7d, " & _
        "  0             AS returned_7d, " & _
        "  0::float      AS delivery_rate_pct, " & _
        "  0::float      AS return_rate_pct " & _
        "FROM packages_stuck"
End Function

Private Function SQL_SlaTipo() As String
    ' Não há pct_on_time no Neon. Derivamos: quanto menor avg_wait_hours, melhor o SLA.
    ' Benchmark: <= 24h = 100%, 48h = 50%, >= 96h = 0%
    SQL_SlaTipo = _
        "SELECT " & _
        "  TO_CHAR(week, 'YYYY-MM-DD') AS week, " & _
        "  association_id, association_name, " & _
        "  resident_type  AS package_type, " & _
        "  entregues, " & _
        "  GREATEST(0, LEAST(100, " & _
        "    ROUND((100 - avg_wait_hours / 0.96)::numeric, 1)" & _
        "  ))             AS pct_on_time, " & _
        "  ROUND((avg_wait_hours / 24)::numeric, 1) AS avg_days, " & _
        "  avg_wait_hours, med_wait_hours " & _
        "FROM sla_by_type " & _
        "ORDER BY week DESC"
End Function

Private Function SQL_RankMoradores() As String
    SQL_RankMoradores = _
        "SELECT " & _
        "  resident_id, resident_name, resident_type, " & _
        "  address_street AS street, " & _
        "  association_id, association_name, " & _
        "  total_packages AS total_received, " & _
        "  pending_now    AS waiting, " & _
        "  delivered, " & _
        "  avg_wait_hours " & _
        "FROM resident_package_ranking " & _
        "ORDER BY pending_now DESC, total_packages DESC " & _
        "LIMIT 50"
End Function

Private Function SQL_OpPerformance() As String
    ' enc_recv = encaminhamentos de recebimento (pacotes recebidos)
    ' enc_delv = encaminhamentos de entrega (pacotes encaminhados para entrega)
    ' Calcula percentual enc_recv_pct como enc_delv/enc_recv * 100
    SQL_OpPerformance = _
        "SELECT " & _
        "  full_name     AS operator_name, " & _
        "  association_id, association_name, " & _
        "  enc_recv      AS packages_received, " & _
        "  enc_delv      AS packages_forwarded, " & _
        "  CASE WHEN enc_recv > 0 " & _
        "    THEN ROUND((enc_delv::numeric / enc_recv * 100), 1) " & _
        "    ELSE 0 END  AS enc_recv_pct, " & _
        "  0             AS revenue_generated, " & _
        "  COALESCE(sessoes, 0) AS active_days " & _
        "FROM operator_performance " & _
        "ORDER BY enc_recv DESC"
End Function

Private Function SQL_TarefasSemana() As String
    SQL_TarefasSemana = _
        "SELECT " & _
        "  TO_CHAR(week, 'YYYY-MM-DD') AS week, " & _
        "  association_id, association_name, " & _
        "  total, concluidas, pendentes, " & _
        "  em_andamento, bloqueadas, em_atraso, " & _
        "  pct_conclusao " & _
        "FROM tasks_weekly " & _
        "ORDER BY week DESC"
End Function

Private Function SQL_RankColab() As String
    SQL_RankColab = _
        "SELECT " & _
        "  assigned_to_name  AS collaborator_name, " & _
        "  association_id, association_name, " & _
        "  concluidas, " & _
        "  pendentes         AS em_andamento, " & _
        "  em_atraso         AS atrasadas, " & _
        "  pct_conclusao     AS taxa_conclusao, " & _
        "  total " & _
        "FROM tasks_by_collaborator " & _
        "ORDER BY concluidas DESC"
End Function

Private Function SQL_KpiOp() As String
    ' operational_kpis: mapeia para os nomes esperados pelo VBA
    SQL_KpiOp = _
        "SELECT " & _
        "  association_id, association_name, " & _
        "  tarefas_abertas   AS os_abertas, " & _
        "  0                 AS os_concluidas, " & _
        "  tarefas_abertas   AS tarefas_semana, " & _
        "  0                 AS tarefas_concluidas, " & _
        "  0                 AS quebras_caixa, " & _
        "  0                 AS sangrias, " & _
        "  associados_ativos, inadimplentes, " & _
        "  enc_paradas_3d, enc_pendentes, " & _
        "  caixas_abertos, receita_hoje, novos_semana " & _
        "FROM operational_kpis"
End Function

Private Function SQL_QuebrasCaixa() As String
    SQL_QuebrasCaixa = _
        "SELECT " & _
        "  TO_CHAR(week, 'YYYY-MM-DD')  AS week, " & _
        "  association_id, association_name, " & _
        "  operador_name                AS operator_name, " & _
        "  total, com_diferenca, com_quebra, " & _
        "  total_diferenca              AS diff, " & _
        "  total_quebra, pct_diferenca " & _
        "FROM cash_breaks " & _
        "ORDER BY week DESC"
End Function


'=============================================================================
' Verifica se tabela existe no schema public
'=============================================================================
Private Function TableExists(tableName As String) As Boolean
    ' Reutiliza conexão global se possível; caso não, retorna False por segurança
    ' (VBA não suporta transações cross-function facilmente com ADODB late-binding)
    ' Solução: tenta SELECT COUNT(*) e captura erro
    ' Esta função é chamada dentro do contexto de RefreshAllData, onde conn já existe.
    ' Por simplificação, usa uma conexão separada rápida lendo a string do _DADOS!B1
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets(SHEET_DADOS)
    On Error GoTo 0
    If ws Is Nothing Then TableExists = False: Exit Function

    Dim connStr As String: connStr = ws.Range(CONN_CELL).Value
    If Len(Trim(connStr)) = 0 Then TableExists = False: Exit Function

    Dim c As Object: Set c = CreateObject("ADODB.Connection")
    Dim rs As Object: Set rs = CreateObject("ADODB.Recordset")
    On Error Resume Next
    c.Open connStr
    rs.Open "SELECT COUNT(*) FROM information_schema.tables " & _
            "WHERE table_schema='public' AND table_name='" & tableName & "'", c
    If Not rs.EOF Then
        TableExists = (rs.Fields(0).Value > 0)
    End If
    rs.Close: c.Close
    Set rs = Nothing: Set c = Nothing
    On Error GoTo 0
End Function


'=============================================================================
' Carrega uma query SQL em um bloco nomeado dentro de _DADOS
'=============================================================================
Private Sub LoadTable(conn As Object, ws As Worksheet, rangeKey As String, sql As String)
    Dim rs      As Object
    Dim destRow As Long
    Dim i       As Long

    On Error GoTo ErrTable

    destRow = FindOrCreateBlock(ws, rangeKey)
    ws.Range(ws.Cells(destRow, 1), ws.Cells(destRow + 10000, 50)).ClearContents

    ws.Cells(destRow, 1).Value = "[" & rangeKey & "]"
    ws.Cells(destRow, 1).Font.Bold = True
    destRow = destRow + 1

    Set rs = CreateObject("ADODB.Recordset")
    rs.Open sql, conn, 0, 1

    If rs.EOF Then
        ws.Cells(destRow, 1).Value = "(sem dados)"
        GoTo Cleanup
    End If

    For i = 0 To rs.Fields.Count - 1
        ws.Cells(destRow, i + 1).Value = rs.Fields(i).Name
        ws.Cells(destRow, i + 1).Font.Bold = True
        ws.Cells(destRow, i + 1).Interior.Color = RGB(13, 33, 55)
        ws.Cells(destRow, i + 1).Font.Color = RGB(255, 255, 255)
    Next i
    destRow = destRow + 1

    ws.Cells(destRow, 1).CopyFromRecordset rs

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    Dim rngName As String: rngName = "DL_" & rangeKey
    On Error Resume Next
    ThisWorkbook.Names(rngName).Delete
    On Error GoTo ErrTable
    ThisWorkbook.Names.Add Name:=rngName, _
        RefersTo:=ws.Range(ws.Cells(destRow, 1), ws.Cells(lastRow, rs.Fields.Count))

Cleanup:
    rs.Close
    Set rs = Nothing
    Exit Sub

ErrTable:
    On Error Resume Next
    If Not rs Is Nothing Then rs.Close
    On Error GoTo 0
    ws.Cells(destRow, 1).Value = "ERRO [" & rangeKey & "]: " & Err.Description
End Sub


'=============================================================================
' Calcula média móvel de 30 dias sobre daily_revenue (client-side)
'=============================================================================
Private Sub CalcMovingAverage(ws As Worksheet)
    Dim rng     As Range
    Dim lastRow As Long
    Dim i       As Long, j As Long
    Dim window  As Integer: window = 30
    Dim soma    As Double, cnt As Integer

    On Error Resume Next
    Set rng = ws.Range("DL_RECEITA_DIARIA")
    On Error GoTo 0
    If rng Is Nothing Then Exit Sub

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colIncome As Integer: colIncome = 0
    Dim col As Integer

    For col = 1 To 30
        If LCase(ws.Cells(headerRow, col).Value) = "total_income" Then
            colIncome = col: Exit For
        End If
    Next col
    If colIncome = 0 Then Exit Sub

    Dim colMA As Integer: colMA = rng.Columns.Count + 1
    With ws.Cells(headerRow, colMA)
        .Value = "ma_30d_income"
        .Font.Bold = True
        .Interior.Color = RGB(8, 145, 178)
        .Font.Color = RGB(255, 255, 255)
    End With

    lastRow = rng.Row + rng.Rows.Count - 1

    ' Dados chegam DESC; para MA correto, processar da linha mais antiga para a mais recente
    ' Inverte o loop: vai do fundo para o topo
    For i = lastRow To rng.Row Step -1
        soma = 0: cnt = 0
        For j = i To Application.Max(lastRow, i + window - 1)  ' olha janela para frente (= dias anteriores no tempo real)
            If IsNumeric(ws.Cells(j, colIncome).Value) Then
                soma = soma + ws.Cells(j, colIncome).Value
                cnt = cnt + 1
            End If
            If j - i >= window - 1 Then Exit For
        Next j
        If cnt > 0 Then
            ws.Cells(i, colMA).Value = Round(soma / cnt, 2)
        End If
    Next i
End Sub


'=============================================================================
' Utilitários
'=============================================================================
Private Function FindOrCreateBlock(ws As Worksheet, key As String) As Long
    Dim i As Long
    Dim lastUsed As Long
    lastUsed = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row

    For i = 1 To lastUsed
        If ws.Cells(i, 1).Value = "[" & key & "]" Then
            FindOrCreateBlock = i
            Exit Function
        End If
    Next i
    FindOrCreateBlock = lastUsed + 3
End Function


Private Function GetOrCreateSheet(name As String) As Worksheet
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Sheets(name)
    On Error GoTo 0

    If ws Is Nothing Then
        Set ws = ThisWorkbook.Sheets.Add(After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count))
        ws.Name = name
        ws.Visible = xlSheetVeryHidden
        ws.Range("A1").Value = "Conexão Neon Analytics:"
        ws.Range("A1").Font.Bold = True
        ws.Range("B1").Value = ""
        ws.Range("A1").ColumnWidth = 25
        ws.Range("B1").ColumnWidth = 100
        ws.Range("B1").Interior.Color = RGB(255, 255, 180)
    End If

    Set GetOrCreateSheet = ws
End Function


Private Sub StampTimestamp()
    Dim ws   As Worksheet
    Dim cell As Range
    Dim ts   As String
    ts = "Atualizado: " & Format(Now, "dd/mm/yyyy hh:mm")

    For Each ws In ThisWorkbook.Worksheets
        If ws.Name <> SHEET_DADOS Then
            On Error Resume Next
            Set cell = ws.Range("TIMESTAMP_" & ws.Name)
            If Not cell Is Nothing Then cell.Value = ts
            On Error GoTo 0
        End If
    Next ws
End Sub
