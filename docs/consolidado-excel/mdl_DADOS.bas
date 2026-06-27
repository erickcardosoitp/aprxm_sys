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
    Dim step_   As String

    t0 = Timer
    On Error GoTo ErrHandler

    step_ = "GetOrCreateSheet"
    Set wsDados = GetOrCreateSheet(SHEET_DADOS)

    step_ = "connStr"
    Dim connStr As String
    connStr = wsDados.Range(CONN_CELL).Value
    If Len(Trim(connStr)) = 0 Then
        MsgBox "Connection string nao configurada em _DADOS!" & CONN_CELL, vbCritical
        Exit Sub
    End If

    step_ = "conn.Open"
    Set conn = CreateObject("ADODB.Connection")
    conn.ConnectionTimeout = 30
    conn.CommandTimeout = 120
    conn.Open connStr

    step_ = "RECEITA_DIARIA":   Call LoadTable(conn, wsDados, "RECEITA_DIARIA",   SQL_ReceitaDiaria())
    step_ = "RECEITA_OP_TIPO":  Call LoadTable(conn, wsDados, "RECEITA_OP_TIPO",  SQL_ReceitaOpTipo())
    step_ = "TAXA_COBRANCA":    Call LoadTable(conn, wsDados, "TAXA_COBRANCA",    SQL_TaxaCobranca())
    step_ = "COBRANCA_RUA":     Call LoadTable(conn, wsDados, "COBRANCA_RUA",     SQL_CobrancaRua())
    step_ = "RUNWAY":           Call LoadTable(conn, wsDados, "RUNWAY",           SQL_Runway())
    step_ = "INADIMPLENCIA":    Call LoadTable(conn, wsDados, "INADIMPLENCIA",    SQL_InadimplenciaAgg())
    step_ = "INADIMPL_PESSOAS": Call LoadTable(conn, wsDados, "INADIMPL_PESSOAS", SQL_InadimplenciaPessoas())
    step_ = "MORADORES_GERAL":  Call LoadTable(conn, wsDados, "MORADORES_GERAL",  SQL_MoradoresGeral())
    step_ = "CRESCIMENTO":      Call LoadTable(conn, wsDados, "CRESCIMENTO",      SQL_Crescimento())
    step_ = "CENSO_RUA":        Call LoadTable(conn, wsDados, "CENSO_RUA",        SQL_CensoRua())
    step_ = "PROBLEMAS":        Call LoadTable(conn, wsDados, "PROBLEMAS",        SQL_Problemas())
    step_ = "PACOTES_STUCK":    Call LoadTable(conn, wsDados, "PACOTES_STUCK",    SQL_PacotesStuck())
    step_ = "SLA_TIPO":         Call LoadTable(conn, wsDados, "SLA_TIPO",         SQL_SlaTipo())
    step_ = "RANK_MORADORES":   Call LoadTable(conn, wsDados, "RANK_MORADORES",   SQL_RankMoradores())
    step_ = "OP_PERFORMANCE":   Call LoadTable(conn, wsDados, "OP_PERFORMANCE",   SQL_OpPerformance())
    step_ = "TAREFAS_SEMANA":   Call LoadTable(conn, wsDados, "TAREFAS_SEMANA",   SQL_TarefasSemana())
    step_ = "RANK_COLAB":       Call LoadTable(conn, wsDados, "RANK_COLAB",       SQL_RankColab())
    step_ = "KPI_OP":           Call LoadTable(conn, wsDados, "KPI_OP",           SQL_KpiOp())
    step_ = "QUEBRAS_CAIXA":    Call LoadTable(conn, wsDados, "QUEBRAS_CAIXA",    SQL_QuebrasCaixa())
    step_ = "RECEITA_MENSAL":       Call LoadTable(conn, wsDados, "RECEITA_MENSAL",       SQL_ReceitaMensal())
    step_ = "RECEITA_MENSAL_ASSOC": Call LoadTable(conn, wsDados, "RECEITA_MENSAL_ASSOC", SQL_ReceitaMensalAssoc())
    step_ = "MORADORES_TOTAL":      Call LoadTable(conn, wsDados, "MORADORES_TOTAL",       SQL_MoradoresTotal())
    step_ = "INADIMPL_TOTAL":       Call LoadTable(conn, wsDados, "INADIMPL_TOTAL",         SQL_InadimplenciaTotal())
    step_ = "CAIXA_ANOMALIAS":      Call LoadTable(conn, wsDados, "CAIXA_ANOMALIAS",        SQL_CaixaAnomalias())
    step_ = "MORADORES_MES":        Call LoadTable(conn, wsDados, "MORADORES_MES",           SQL_MoradoresMes())
    step_ = "PACOTES_MES":          Call LoadTable(conn, wsDados, "PACOTES_MES",             SQL_PacotesMes())
    step_ = "OS_MES":               Call LoadTable(conn, wsDados, "OS_MES",                 SQL_OsMes())
    step_ = "RETENCAO_MES":         Call LoadTable(conn, wsDados, "RETENCAO_MES",           SQL_RetencaoMes())
    step_ = "TASKS_MES":            Call LoadTable(conn, wsDados, "TASKS_MES",              SQL_TasksMes())
    step_ = "OP_SCORE_MES":         Call LoadTable(conn, wsDados, "OP_SCORE_MES",           SQL_OpScoreMes())
    step_ = "MARGEM_MES":           Call LoadTable(conn, wsDados, "MARGEM_MES",             SQL_MargemMes())
    step_ = "CalcMovingAverage": Call CalcMovingAverage(wsDados)
    step_ = "StampTimestamp":    Call StampTimestamp()

    conn.Close
    Set conn = Nothing

    ' Descomente para re-ocultar após o refresh:
    ' wsDados.Visible = xlSheetVeryHidden

    Application.StatusBar = False
    MsgBox "Dados atualizados em " & Format(Now, "dd/mm/yyyy hh:mm") & _
           " (" & Format(Timer - t0, "0.0") & "s)", vbInformation, "APRXM Aproxima"
    Exit Sub

ErrHandler:
    Dim errNum As Long: errNum = Err.Number
    Dim errDesc As String: errDesc = Err.Description
    Dim errSrc As String: errSrc = Err.Source
    On Error Resume Next
    If Not conn Is Nothing Then
        If conn.State = 1 Then conn.Close
    End If
    On Error GoTo 0
    Application.StatusBar = False
    MsgBox "Erro ao carregar dados:" & vbCrLf & _
           "Step: " & step_ & vbCrLf & _
           "Num: " & errNum & " | Fonte: " & errSrc & vbCrLf & _
           errDesc, vbCritical, "APRXM - Erro"
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
        "FROM daily_revenue" & Filter() & _
        " ORDER BY date DESC"
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
            "FROM receita_por_operador_tipo" & Filter() & _
            " ORDER BY week DESC, total DESC"
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
            "FROM operator_revenue" & Filter() & _
            " ORDER BY week DESC, receita DESC"
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
        "  taxa_pct                  AS pct_paid, " & _
        "  ROUND((100 - taxa_pct)::numeric, 1) AS pct_pendente " & _
        "FROM collection_rate" & Filter() & _
        " ORDER BY month DESC"
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
            "FROM cobranca_por_rua" & Filter() & _
            " ORDER BY month DESC, valor_total DESC"
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
        "FROM runway" & Filter()
End Function

Private Function SQL_InadimplenciaAgg() As String
    ' Agrega delinquency_report + collection_rate para produzir KPIs de mensalidades.
    ' delinquency_report = pessoas com overdue_months > 0 (já vencidas).
    ' collection_rate    = totais de cobrança por mês.
    ' Usamos o mês mais recente de collection_rate para paid/total.
    SQL_InadimplenciaAgg = _
        "WITH cr AS ( SELECT association_id, " & _
        "  SUM(paid) AS pagas, SUM(total - paid) AS pendentes, " & _
        "  SUM(valor_total) AS valor_total, SUM(valor_pago) AS valor_pago " & _
        "  FROM collection_rate " & _
        "  WHERE month >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'" & FilterAnd() & _
        "  GROUP BY association_id " & _
        "), dr AS ( " & _
        "  SELECT association_id, association_name, " & _
        "    COUNT(*) AS vencidas, SUM(total_owed) AS total_owed " & _
        "  FROM delinquency_report" & Filter() & _
        "  GROUP BY association_id, association_name " & _
        ") SELECT dr.association_id, dr.association_name, " & _
        "  COALESCE(cr.pagas, 0)::int AS pagas, " & _
        "  COALESCE(cr.pendentes, 0)::int AS pendentes, " & _
        "  COALESCE(dr.vencidas, 0)::int AS vencidas, " & _
        "  0 AS acordos, 0 AS isentas, " & _
        "  COALESCE(cr.valor_pago, 0) AS valor_pago, " & _
        "  COALESCE(cr.valor_total, 0) AS valor_total, " & _
        "  COALESCE(dr.total_owed, 0) AS total_owed " & _
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
        "FROM delinquency_report" & Filter() & _
        " ORDER BY total_owed DESC"
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
        "FROM resident_overview" & Filter()
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
        "FROM member_growth_weekly" & Filter() & _
        " GROUP BY week, association_id, association_name " & _
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
        "FROM census_by_street" & Filter() & _
        " ORDER BY total DESC"
End Function

Private Function SQL_Problemas() As String
    SQL_Problemas = _
        "SELECT " & _
        "  problem       AS problem_type, " & _
        "  association_id, association_name, " & _
        "  ocorrencias, associados, visitantes, " & _
        "  NULL          AS last_seen, " & _
        "  'aberto'      AS status " & _
        "FROM community_problems" & Filter() & _
        " ORDER BY ocorrencias DESC"
End Function

Private Function SQL_PacotesStuck() As String
    SQL_PacotesStuck = _
        "SELECT " & _
        "  association_id, association_name, " & _
        "  paradas_3d    AS total, " & _
        "  paradas_3d    AS stuck_3d, " & _
        "  paradas_7d, " & _
        "  paradas_3d    AS total_waiting, " & _
        "  0             AS delivered_7d, " & _
        "  0             AS returned_7d, " & _
        "  0::float      AS delivery_rate_pct, " & _
        "  0::float      AS return_rate_pct " & _
        "FROM packages_stuck" & Filter()
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
        "FROM sla_by_type" & Filter() & _
        " ORDER BY week DESC"
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
        "FROM resident_package_ranking" & Filter() & _
        " ORDER BY pending_now DESC, total_packages DESC " & _
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
        "    THEN ROUND((enc_delv::numeric / enc_recv::numeric * 100), 1) " & _
        "    ELSE 0 END  AS enc_recv_pct, " & _
        "  0             AS revenue_generated, " & _
        "  COALESCE(sessoes, 0) AS active_days " & _
        "FROM operator_performance" & Filter() & _
        " ORDER BY enc_recv DESC"
End Function

Private Function SQL_TarefasSemana() As String
    SQL_TarefasSemana = _
        "SELECT " & _
        "  TO_CHAR(week, 'YYYY-MM-DD') AS week, " & _
        "  association_id, association_name, " & _
        "  total, concluidas, pendentes, " & _
        "  em_andamento, bloqueadas, em_atraso, " & _
        "  pct_conclusao " & _
        "FROM tasks_weekly" & Filter() & _
        " ORDER BY week DESC"
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
        "FROM tasks_by_collaborator" & Filter() & _
        " ORDER BY concluidas DESC"
End Function

Private Function SQL_KpiOp() As String
    ' Colunas novas podem nao existir — verifica antes de incluir no SELECT
    Dim extraCols As String
    If ColumnExists("operational_kpis", "avg_dwell_dias") Then
        extraCols = ", COALESCE(avg_dwell_dias,    0) AS avg_dwell_dias" & _
                    ", COALESCE(taxa_retencao_pct, 0) AS taxa_retencao_pct"
    Else
        extraCols = ", 0::float AS avg_dwell_dias" & _
                    ", 0::float AS taxa_retencao_pct"
    End If
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
        "  caixas_abertos, receita_hoje, novos_semana" & extraCols & _
        " FROM operational_kpis" & Filter()
End Function

Private Function ColumnExists(tableName As String, colName As String) As Boolean
    Dim ws As Worksheet
    On Error Resume Next: Set ws = ThisWorkbook.Sheets(SHEET_DADOS): On Error GoTo 0
    If ws Is Nothing Then ColumnExists = False: Exit Function
    Dim connStr As String: connStr = ws.Range(CONN_CELL).Value
    If Len(Trim(connStr)) = 0 Then ColumnExists = False: Exit Function
    Dim c As Object: Set c = CreateObject("ADODB.Connection")
    Dim rs As Object: Set rs = CreateObject("ADODB.Recordset")
    On Error Resume Next
    c.Open connStr
    rs.Open "SELECT COUNT(*) FROM information_schema.columns " & _
            "WHERE table_schema='public' AND table_name='" & tableName & _
            "' AND column_name='" & colName & "'", c
    If Not rs.EOF Then ColumnExists = (rs.Fields(0).Value > 0)
    rs.Close: c.Close
    Set rs = Nothing: Set c = Nothing
    On Error GoTo 0
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
        "FROM cash_breaks" & Filter() & _
        " ORDER BY week DESC"
End Function


'=============================================================================
' Queries agregadas — combinam ambas as associações para KPIs do INICIO
'=============================================================================

Private Function SQL_ReceitaMensal() As String
    ' SUM por mês, ambas as associações combinadas
    SQL_ReceitaMensal = _
        "SELECT TO_CHAR(month, 'YYYY-MM') AS month, " & _
        "  SUM(total_income)         AS total_income, " & _
        "  SUM(total_expense)        AS total_expense, " & _
        "  SUM(mensalidade)          AS mensalidade, " & _
        "  SUM(delivery_fee)         AS delivery_fee, " & _
        "  SUM(proof_of_residence)   AS proof_of_residence, " & _
        "  SUM(other_income)         AS other_income " & _
        "FROM daily_revenue" & Filter() & _
        " GROUP BY month ORDER BY month DESC"
End Function

Private Function SQL_MoradoresTotal() As String
    ' SUM de moradores entre todas as associações válidas
    SQL_MoradoresTotal = _
        "SELECT " & _
        "  SUM(total_ativos)  AS total, " & _
        "  SUM(members)       AS members, " & _
        "  SUM(guests)        AS guests, " & _
        "  SUM(dependents)    AS dependents, " & _
        "  0                  AS delinquent, " & _
        "  SUM(novos_mes)     AS active_30d " & _
        "FROM resident_overview" & Filter()
End Function

Private Function SQL_ReceitaMensalAssoc() As String
    ' SUM por mês + associação — para filtro por associação no INICIO
    SQL_ReceitaMensalAssoc = _
        "SELECT TO_CHAR(month, 'YYYY-MM') AS month, " & _
        "  association_name, " & _
        "  SUM(total_income)        AS total_income, " & _
        "  SUM(total_expense)       AS total_expense, " & _
        "  SUM(mensalidade)         AS mensalidade, " & _
        "  SUM(delivery_fee)        AS delivery_fee, " & _
        "  SUM(proof_of_residence)  AS proof_of_residence, " & _
        "  SUM(other_income)        AS other_income " & _
        "FROM daily_revenue" & Filter() & _
        " GROUP BY month, association_name ORDER BY month DESC"
End Function

Private Function SQL_CaixaAnomalias() As String
    If Not TableExists("cash_session_anomalies") Then
        SQL_CaixaAnomalias = "SELECT NULL::uuid AS association_id, NULL::text AS association_name, " & _
            "NULL::text AS operador_name, NULL::text AS dia, " & _
            "NULL::text AS hora_abertura, NULL::text AS hora_fechamento, " & _
            "NULL::float AS duracao_min, NULL::text AS anomalia WHERE 1=0"
        Exit Function
    End If
    SQL_CaixaAnomalias = _
        "SELECT association_id, association_name, operador_name, " & _
        "  dia, hora_abertura, hora_fechamento, duracao_min, anomalia " & _
        "FROM cash_session_anomalies" & Filter() & _
        " ORDER BY dia DESC, anomalia"
End Function

Private Function SQL_InadimplenciaTotal() As String
    ' Inadimplência combinada das duas associações (sem agrupamento por assoc.)
    SQL_InadimplenciaTotal = _
        "WITH cr AS ( " & _
        "  SELECT SUM(paid) AS pagas, SUM(total - paid) AS pendentes, " & _
        "    SUM(valor_total) AS valor_total, SUM(valor_pago) AS valor_pago " & _
        "  FROM collection_rate " & _
        "  WHERE month >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'" & FilterAnd() & _
        "), dr AS ( " & _
        "  SELECT COUNT(*) AS vencidas, SUM(total_owed) AS total_owed " & _
        "  FROM delinquency_report" & Filter() & _
        ") SELECT " & _
        "  COALESCE(cr.pagas,    0)::int AS pagas, " & _
        "  COALESCE(cr.pendentes,0)::int AS pendentes, " & _
        "  COALESCE(dr.vencidas, 0)::int AS vencidas, " & _
        "  COALESCE(dr.total_owed, 0)    AS total_owed " & _
        "FROM cr, dr"
End Function


Private Function SQL_MoradoresMes() As String
    If Not TableExists("resident_monthly") Then
        SQL_MoradoresMes = "SELECT NULL::text AS month, NULL::uuid AS association_id, " & _
            "NULL::text AS association_name, 0::int AS total, 0::int AS members, " & _
            "0::int AS dependents, 0::int AS guests WHERE 1=0"
        Exit Function
    End If
    SQL_MoradoresMes = _
        "SELECT month, association_id, association_name, total, members, dependents, guests " & _
        "FROM resident_monthly" & Filter() & " ORDER BY month DESC"
End Function

Private Function SQL_PacotesMes() As String
    If Not TableExists("packages_monthly") Then
        SQL_PacotesMes = "SELECT NULL::text AS month, NULL::uuid AS association_id, " & _
            "NULL::text AS association_name, 0::int AS recebidos, 0::int AS entregues, " & _
            "0::int AS devolvidos, 0::int AS pendentes, 0::float AS avg_dwell_dias WHERE 1=0"
        Exit Function
    End If
    SQL_PacotesMes = _
        "SELECT month, association_id, association_name, recebidos, entregues, " & _
        "  devolvidos, pendentes, avg_dwell_dias " & _
        "FROM packages_monthly" & Filter() & " ORDER BY month DESC"
End Function

Private Function SQL_OsMes() As String
    If Not TableExists("os_monthly") Then
        SQL_OsMes = "SELECT NULL::text AS month, NULL::uuid AS association_id, " & _
            "NULL::text AS association_name, 0::int AS abertas, 0::int AS fechadas, " & _
            "0::int AS pendentes WHERE 1=0"
        Exit Function
    End If
    SQL_OsMes = _
        "SELECT month, association_id, association_name, abertas, fechadas, pendentes " & _
        "FROM os_monthly" & Filter() & " ORDER BY month DESC"
End Function

Private Function SQL_RetencaoMes() As String
    If Not TableExists("retention_monthly") Then
        SQL_RetencaoMes = "SELECT NULL::text AS month, NULL::uuid AS association_id, " & _
            "NULL::text AS association_name, 0::int AS pagantes_mes_ant, " & _
            "0::int AS retidos, 0::float AS taxa_retencao WHERE 1=0"
        Exit Function
    End If
    SQL_RetencaoMes = _
        "SELECT month, association_id, association_name, " & _
        "  pagantes_mes_ant, retidos, " & _
        "  COALESCE(taxa_retencao, 0) AS taxa_retencao " & _
        "FROM retention_monthly" & Filter() & " ORDER BY month DESC"
End Function

Private Function SQL_TasksMes() As String
    If Not TableExists("tasks_monthly") Then
        SQL_TasksMes = "SELECT NULL::text AS month, NULL::uuid AS association_id, " & _
            "NULL::text AS association_name, 0::int AS total, 0::int AS concluidas, " & _
            "0::int AS pendentes, 0::float AS pct_on_time WHERE 1=0"
        Exit Function
    End If
    SQL_TasksMes = _
        "SELECT month, association_id, association_name, " & _
        "  total, concluidas, pendentes, " & _
        "  COALESCE(pct_on_time, 0) AS pct_on_time " & _
        "FROM tasks_monthly" & Filter() & " ORDER BY month DESC"
End Function

Private Function SQL_OpScoreMes() As String
    If Not TableExists("operator_score_monthly") Then
        SQL_OpScoreMes = "SELECT NULL::text AS month, NULL::uuid AS association_id, " & _
            "NULL::text AS association_name, 0::float AS score WHERE 1=0"
        Exit Function
    End If
    ' Agrega para uma linha por (month, association): AVG score, SUM estornos/entregas
    SQL_OpScoreMes = _
        "SELECT month, association_id, association_name, " & _
        "  ROUND(AVG(score)::numeric, 1)    AS score, " & _
        "  SUM(estornos)                    AS estornos, " & _
        "  SUM(tarefas_atraso)              AS tarefas_atraso, " & _
        "  SUM(entregas)                    AS entregas " & _
        "FROM operator_score_monthly" & Filter() & _
        " GROUP BY month, association_id, association_name" & _
        " ORDER BY month DESC"
End Function

Private Function SQL_MargemMes() As String
    If Not TableExists("margem_mensal") Then
        SQL_MargemMes = "SELECT NULL::text AS month, NULL::uuid AS association_id, " & _
            "NULL::text AS association_name, 0::float AS total_income, " & _
            "0::float AS total_expense, 0::float AS net, 0::float AS margem_pct WHERE 1=0"
        Exit Function
    End If
    SQL_MargemMes = _
        "SELECT month, association_id, association_name, " & _
        "  total_income, total_expense, net, margem_pct " & _
        "FROM margem_mensal" & Filter() & " ORDER BY month DESC"
End Function


'=============================================================================
' Filtro padrao: exclui associacao de teste
'=============================================================================
Private Function Filter() As String
    Filter = " WHERE association_id <> '4fe13112-2422-4d7a-b2e5-37c7da58ec9c'"
End Function

Private Function FilterAnd() As String
    FilterAnd = " AND association_id <> '4fe13112-2422-4d7a-b2e5-37c7da58ec9c'"
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
    Dim rs         As Object
    Dim destRow    As Long
    Dim i          As Long
    Dim fieldCount As Integer

    On Error GoTo ErrTable

    destRow = FindOrCreateBlock(ws, rangeKey)

    ' 1. Unlist existing ListObject before clearing (prevents conflict)
    Dim lo As ListObject
    On Error Resume Next
    Set lo = ws.ListObjects("tbl_" & rangeKey)
    If Not lo Is Nothing Then lo.Unlist
    Set lo = Nothing
    On Error GoTo ErrTable

    ' 2. Clear area
    ws.Range(ws.Cells(destRow, 1), ws.Cells(destRow + 10000, 50)).ClearContents

    ' 3. Block marker
    ws.Cells(destRow, 1).Value = "[" & rangeKey & "]"
    ws.Cells(destRow, 1).Font.Bold = True
    destRow = destRow + 1  ' header row

    Application.StatusBar = "Carregando: " & rangeKey & "..."

    Set rs = CreateObject("ADODB.Recordset")
    rs.Open sql, conn, 0, 1

    If rs.EOF Then
        ws.Cells(destRow, 1).Value = "(sem dados)"
        GoTo Cleanup
    End If

    fieldCount = rs.Fields.Count

    ' 4. Write headers
    Dim headerRow As Long: headerRow = destRow
    For i = 0 To fieldCount - 1
        ws.Cells(headerRow, i + 1).Value = rs.Fields(i).Name
        ws.Cells(headerRow, i + 1).Font.Bold = True
        ws.Cells(headerRow, i + 1).Interior.Color = RGB(20, 19, 35)
        ws.Cells(headerRow, i + 1).Font.Color = RGB(255, 255, 255)
    Next i
    destRow = destRow + 1  ' first data row

    ' 5. Write data
    ws.Cells(destRow, 1).CopyFromRecordset rs

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row

    ' 6. Named range DL_ (data rows only, sem header) — compatibilidade GetScalar
    Dim rngName As String: rngName = "DL_" & rangeKey
    On Error Resume Next
    ThisWorkbook.Names(rngName).Delete
    On Error GoTo ErrTable
    ThisWorkbook.Names.Add Name:=rngName, _
        RefersTo:=ws.Range(ws.Cells(destRow, 1), ws.Cells(lastRow, fieldCount))

    ' 7. Criar ListObject (Excel Table) — habilita Tabela Dinamica + Slicer nativo
    On Error Resume Next
    Dim tblRange As Range
    Set tblRange = ws.Range(ws.Cells(headerRow, 1), ws.Cells(lastRow, fieldCount))
    Dim newLo As ListObject
    Set newLo = ws.ListObjects.Add(xlSrcRange, tblRange, , xlYes)
    If Not newLo Is Nothing Then
        newLo.Name = "tbl_" & rangeKey
        newLo.TableStyle = "TableStyleLight1"
    End If
    On Error GoTo ErrTable

Cleanup:
    rs.Close
    Set rs = Nothing
    Exit Sub

ErrTable:
    Dim tblErrNum As Long: tblErrNum = Err.Number
    Dim tblErrDesc As String: tblErrDesc = Err.Description
    On Error Resume Next
    If Not rs Is Nothing Then rs.Close
    Set rs = Nothing
    If destRow > 0 Then
        ws.Cells(destRow, 1).Value = "ERRO [" & rangeKey & "] #" & tblErrNum & ": " & tblErrDesc
    End If
    On Error GoTo 0
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


