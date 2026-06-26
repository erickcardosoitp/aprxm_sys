Attribute VB_Name = "mdl_Financeiro"
'=============================================================================
' Aba: FINANCEIRO — Visão Financeira Completa
' Perguntas diretriz:
'   "Quanto arrecadamos e de onde vem o dinheiro?"
'   "Qual operador está gerando mais receita e em quais categorias?"
'   "A receita diária está acima ou abaixo da média histórica?"
'=============================================================================
Option Explicit

Private Const CLR_NAVY     As Long = 888337
Private Const CLR_CERULEAN As Long = 11573706
Private Const CLR_AMBER    As Long = 1023485
Private Const CLR_WHITE    As Long = 16777215
Private Const CLR_LIGHT    As Long = 15921906
Private Const CLR_GREEN    As Long = 338720
Private Const CLR_RED      As Long = 3942400

Public Sub PopulateFinanceiro()
    Dim ws     As Worksheet
    Dim wsDados As Worksheet

    On Error GoTo ErrHandler

    Set ws = ThisWorkbook.Sheets("FINANCEIRO")
    Set wsDados = ThisWorkbook.Sheets("_DADOS")

    Application.ScreenUpdating = False
    ws.Range("B4:P100").ClearContents

    ' Perguntas diretriz
    With ws.Range("B4")
        .Value = Chr(8220) & "Quanto arrecadamos e de onde vem o dinheiro? Qual operador gera mais receita?" & Chr(8221)
        .Font.Italic = True
        .Font.Color = CLR_CERULEAN
        .Font.Size = 10
    End With

    ' ── Seção 1: KPIs financeiros do mês ────────────────────────────────────
    WriteFinancialKPIs ws, wsDados

    ' ── Seção 2: Receita por operador × tipo ────────────────────────────────
    WriteRevenueByOperator ws, wsDados

    ' ── Seção 3: Dados para gráfico de linha diário + MA ────────────────────
    WriteChartData ws, wsDados

    ' ── Seção 4: Runway ─────────────────────────────────────────────────────
    WriteRunway ws, wsDados

    Application.ScreenUpdating = True
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    MsgBox "Erro em PopulateFinanceiro: " & Err.Description, vbCritical
End Sub


Private Sub WriteFinancialKPIs(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 6
    Dim c As Long: c = 2

    WriteBlockHeader ws, r, c, "RECEITA DO MÊS ATUAL", 8

    r = r + 1
    Dim mesAtual As String: mesAtual = Format(Now, "yyyy-mm")

    ' KPIs em linha
    Dim kpis(4) As String
    Dim vals(4) As Variant
    kpis(0) = "Total de Receita"
    kpis(1) = "Mensalidades"
    kpis(2) = "Taxa de Entrega"
    kpis(3) = "Comp. de Residência"
    kpis(4) = "Outras Receitas"

    vals(0) = mdl_Inicio.GetScalar(wsDados, "RECEITA_DIARIA", "total_income", "month", mesAtual)

    ' Para breakdown por tipo, soma da tabela receita_op_tipo filtrado pelo mês
    vals(1) = SumByMonth(wsDados, "RECEITA_OP_TIPO", "mensalidade", "month", mesAtual)
    vals(2) = SumByMonth(wsDados, "RECEITA_OP_TIPO", "delivery_fee", "month", mesAtual)
    vals(3) = SumByMonth(wsDados, "RECEITA_OP_TIPO", "proof_of_residence", "month", mesAtual)
    vals(4) = SumByMonth(wsDados, "RECEITA_OP_TIPO", "other_income", "month", mesAtual)

    Dim i As Integer
    For i = 0 To 4
        With ws.Cells(r, c + i)
            .Value = kpis(i)
            .Font.Bold = True
            .Font.Size = 8
            .Interior.Color = CLR_NAVY
            .Font.Color = CLR_WHITE
        End With
        Dim displayVal As String
        If IsEmpty(vals(i)) Or vals(i) = 0 Then
            displayVal = "R$ 0,00"
        Else
            displayVal = "R$ " & Format(CDbl(vals(i)), "#,##0.00")
        End If
        With ws.Cells(r + 1, c + i)
            .Value = displayVal
            .Font.Bold = True
            .Font.Size = 12
            If i = 0 Then
                .Font.Color = CLR_CERULEAN
            Else
                .Font.Color = CLR_NAVY
            End If
            .HorizontalAlignment = xlCenter
        End With
    Next i
End Sub


Private Sub WriteRevenueByOperator(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 11
    Dim c As Long: c = 2

    WriteBlockHeader ws, r, c, "RECEITA POR OPERADOR × TIPO (SEMANA ATUAL)", 9

    r = r + 1

    ' Cabeçalhos
    Dim hdrs As Variant
    hdrs = Array("Operador", "Mensalidade", "Taxa Entrega", "Comp. Residência", "Outras", "TOTAL", "Nº Transações")
    Dim i As Integer
    For i = 0 To 6
        With ws.Cells(r, c + i)
            .Value = hdrs(i)
            .Font.Bold = True
            .Font.Size = 8
            .Interior.Color = CLR_CERULEAN
            .Font.Color = CLR_WHITE
        End With
    Next i

    r = r + 1

    ' Carrega dados do range RECEITA_OP_TIPO
    Dim rng As Range
    On Error Resume Next
    Set rng = wsDados.Range("DL_RECEITA_OP_TIPO")
    On Error GoTo 0

    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados de receita por operador)"
        Exit Sub
    End If

    ' Descobre índice de colunas
    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colMap(6) As Integer  ' 0=operator_name, 1=mensalidade, 2=delivery_fee, 3=proof_of_residence, 4=other_income, 5=total, 6=n_transacoes
    Dim colNames(6) As String
    colNames(0) = "created_by_name"
    colNames(1) = "mensalidade"
    colNames(2) = "delivery_fee"
    colNames(3) = "proof_of_residence"
    colNames(4) = "other_income"
    colNames(5) = "total"
    colNames(6) = "n_transacoes"

    Dim col As Integer
    For col = 1 To 30
        Dim h As String
        h = LCase(wsDados.Cells(headerRow, col).Value)
        Dim j As Integer
        For j = 0 To 6
            If h = colNames(j) Then colMap(j) = col
        Next j
    Next col

    ' Filtra pela semana atual (ISO week)
    Dim weekStr As String
    weekStr = Format(Now - Weekday(Now, 2) + 1, "yyyy-mm-dd")  ' segunda desta semana

    Dim rowNum As Long
    Dim bgToggle As Boolean
    bgToggle = True

    For rowNum = rng.Row To rng.Row + rng.Rows.Count - 1
        Dim rowDate As String
        If colMap(0) = 0 Then Exit For
        ' Exibe todos (filtragem por semana feita na query SQL já: ORDER BY week DESC pega semana mais recente primeiro)
        ' Limitamos aqui às primeiras 20 linhas visíveis
        If rowNum > rng.Row + 19 Then Exit For

        Dim operName As String
        operName = CStr(wsDados.Cells(rowNum, colMap(0)).Value)
        If Len(Trim(operName)) = 0 Then Exit For

        With ws.Cells(r, c)
            .Value = operName
            .Font.Size = 8
        End With

        Dim fmtVals(5) As String
        For i = 1 To 5
            If colMap(i) > 0 Then
                Dim v As Double
                v = SafeD(wsDados.Cells(rowNum, colMap(i)).Value)
                If i = 6 Then
                    fmtVals(i - 1) = CStr(CLng(v))
                Else
                    fmtVals(i - 1) = "R$ " & Format(v, "#,##0.00")
                End If
            Else
                fmtVals(i - 1) = "–"
            End If
            ws.Cells(r, c + i).Value = fmtVals(i - 1)
            ws.Cells(r, c + i).HorizontalAlignment = xlRight
            ws.Cells(r, c + i).Font.Size = 8
        Next i

        ' Nº transações
        If colMap(6) > 0 Then
            ws.Cells(r, c + 6).Value = CLng(SafeD(wsDados.Cells(rowNum, colMap(6)).Value))
            ws.Cells(r, c + 6).HorizontalAlignment = xlCenter
        End If

        ' Linha TOTAL em negrito + cor
        If i = 5 Then
            ws.Cells(r, c + 5).Font.Bold = True
            ws.Cells(r, c + 5).Font.Color = CLR_CERULEAN
        End If

        If bgToggle Then
            ws.Range(ws.Cells(r, c), ws.Cells(r, c + 6)).Interior.Color = CLR_LIGHT
        End If
        bgToggle = Not bgToggle
        r = r + 1
    Next rowNum
End Sub


Private Sub WriteChartData(ws As Worksheet, wsDados As Worksheet)
    ' Escreve os dados de receita diária + MA30 em uma área nomeada
    ' para alimentar um gráfico de linha inserido manualmente
    Dim r As Long: r = 35
    Dim c As Long: c = 2

    WriteBlockHeader ws, r, c, "DADOS: RECEITA DIÁRIA vs MÉDIA MÓVEL 30 DIAS", 8

    r = r + 1

    ' Cabeçalhos
    ws.Cells(r, c).Value = "Data"
    ws.Cells(r, c + 1).Value = "Receita Diária"
    ws.Cells(r, c + 2).Value = "Média Móvel 30d"
    ws.Range(ws.Cells(r, c), ws.Cells(r, c + 2)).Font.Bold = True
    ws.Range(ws.Cells(r, c), ws.Cells(r, c + 2)).Interior.Color = CLR_CERULEAN
    ws.Range(ws.Cells(r, c), ws.Cells(r, c + 2)).Font.Color = CLR_WHITE

    r = r + 1

    Dim rng As Range
    On Error Resume Next
    Set rng = wsDados.Range("DL_RECEITA_DIARIA")
    On Error GoTo 0

    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados de receita diária)"
        Exit Sub
    End If

    ' Descobre colunas de data, total_income e ma_30d_income
    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colDate As Integer: colDate = 0
    Dim colIncome As Integer: colIncome = 0
    Dim colMA As Integer: colMA = 0
    Dim col As Integer

    For col = 1 To 50
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        If h = "date" Then colDate = col
        If h = "total_income" Then colIncome = col
        If h = "ma_30d_income" Then colMA = col
    Next col

    ' Copia últimos 90 dias de dados (dados vêm DESC, então reverter)
    Dim dados() As Variant
    Dim nRows As Long: nRows = Application.Min(90, rng.Rows.Count)
    ReDim dados(1 To nRows, 1 To 3)

    Dim rowNum As Long
    Dim idx As Long: idx = 1
    ' Os dados estão em ordem DESC; preenchemos de trás para frente
    For rowNum = rng.Row + nRows - 1 To rng.Row Step -1
        If colDate > 0 Then dados(idx, 1) = wsDados.Cells(rowNum, colDate).Value
        If colIncome > 0 Then dados(idx, 2) = SafeD(wsDados.Cells(rowNum, colIncome).Value)
        If colMA > 0 Then dados(idx, 3) = SafeD(wsDados.Cells(rowNum, colMA).Value)
        idx = idx + 1
        If idx > nRows Then Exit For
    Next rowNum

    ' Escreve na aba
    Dim i As Long
    For i = 1 To nRows
        ws.Cells(r + i - 1, c).Value = dados(i, 1)
        ws.Cells(r + i - 1, c).NumberFormat = "dd/mm/yyyy"
        ws.Cells(r + i - 1, c + 1).Value = dados(i, 2)
        ws.Cells(r + i - 1, c + 1).NumberFormat = "#,##0.00"
        ws.Cells(r + i - 1, c + 2).Value = dados(i, 3)
        ws.Cells(r + i - 1, c + 2).NumberFormat = "#,##0.00"

        If i Mod 2 = 0 Then
            ws.Range(ws.Cells(r + i - 1, c), ws.Cells(r + i - 1, c + 2)).Interior.Color = CLR_LIGHT
        End If
    Next i

    ' Define nome para o gráfico referenciar
    On Error Resume Next
    ThisWorkbook.Names("CHART_RECEITA_DIARIA").Delete
    On Error GoTo 0
    ThisWorkbook.Names.Add Name:="CHART_RECEITA_DIARIA", _
        RefersTo:=ws.Range(ws.Cells(r, c), ws.Cells(r + nRows - 1, c + 2))

    ' Cria ou atualiza gráfico de linha
    CreateRevenueChart ws, ws.Range(ws.Cells(r, c), ws.Cells(r + nRows - 1, c + 2)), r
End Sub


Private Sub CreateRevenueChart(ws As Worksheet, dataRange As Range, dataRow As Long)
    Dim cht As ChartObject
    Dim newChart As Boolean
    newChart = True

    ' Remove gráfico existente se houver
    Dim co As ChartObject
    For Each co In ws.ChartObjects
        If co.Name = "GraficoReceitaDiaria" Then
            co.Delete
            Exit For
        End If
    Next co

    ' Cria novo gráfico
    Dim chartLeft As Double: chartLeft = ws.Cells(dataRow, 8).Left
    Dim chartTop  As Double: chartTop  = ws.Cells(dataRow, 8).Top
    Set cht = ws.ChartObjects.Add(chartLeft, chartTop, 500, 240)
    cht.Name = "GraficoReceitaDiaria"

    With cht.Chart
        .ChartType = xlLine
        .SetSourceData Source:=dataRange

        ' Formata série 1 (Receita Diária)
        With .SeriesCollection(1)
            .Name = "Receita Diária"
            .Format.Line.ForeColor.RGB = RGB(8, 145, 178)   ' Cerulean
            .Format.Line.Weight = 1.5
        End With

        ' Formata série 2 (Média Móvel 30d)
        If .SeriesCollection.Count >= 2 Then
            With .SeriesCollection(2)
                .Name = "Média Móvel 30d"
                .Format.Line.ForeColor.RGB = RGB(245, 158, 11)  ' Amber
                .Format.Line.Weight = 2.5
                .Format.Line.DashStyle = msoLineDash
            End With
        End If

        ' Estilo geral
        .PlotArea.Format.Fill.ForeColor.RGB = RGB(243, 244, 246)
        .ChartArea.Format.Fill.ForeColor.RGB = CLR_WHITE
        .HasTitle = True
        .ChartTitle.Text = "Receita Diária vs Média Móvel 30 dias"
        .ChartTitle.Font.Size = 10
        .ChartTitle.Font.Color = CLR_NAVY
        .HasLegend = True
        .Legend.Position = xlLegendPositionBottom

        ' Eixo X: datas
        With .Axes(xlCategory)
            .TickLabelPosition = xlLow
            .TickLabels.Font.Size = 7
            .TickLabels.NumberFormat = "dd/mm"
        End With

        ' Eixo Y: valores R$
        With .Axes(xlValue)
            .TickLabels.Font.Size = 7
            .TickLabels.NumberFormat = "R$#,##0"
        End With
    End With
End Sub


Private Sub WriteRunway(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 11
    Dim c As Long: c = 9

    WriteBlockHeader ws, r, c, "RUNWAY FINANCEIRO", 4

    r = r + 1

    Dim runway As Variant
    runway = mdl_Inicio.GetScalar(wsDados, "RUNWAY", "months_of_runway", "", "")
    Dim saldo As Variant
    saldo = mdl_Inicio.GetScalar(wsDados, "RUNWAY", "current_balance", "", "")
    Dim despMed As Variant
    despMed = mdl_Inicio.GetScalar(wsDados, "RUNWAY", "avg_monthly_expense", "", "")

    WriteDataRow ws, r, c, "Saldo atual", IIf(IsEmpty(saldo), "–", "R$ " & Format(CDbl(saldo), "#,##0.00"))
    WriteDataRow ws, r + 1, c, "Despesa média mensal", IIf(IsEmpty(despMed), "–", "R$ " & Format(CDbl(despMed), "#,##0.00"))

    With ws.Cells(r + 2, c)
        .Value = "Runway estimado"
        .Font.Size = 9
    End With
    With ws.Cells(r + 2, c + 1)
        If IsEmpty(runway) Then
            .Value = "–"
        ElseIf CDbl(runway) < 2 Then
            .Value = Format(CDbl(runway), "0.1") & " meses ⚠"
            .Font.Color = CLR_RED
        ElseIf CDbl(runway) < 4 Then
            .Value = Format(CDbl(runway), "0.1") & " meses"
            .Font.Color = CLR_AMBER
        Else
            .Value = Format(CDbl(runway), "0.1") & " meses ✓"
            .Font.Color = CLR_GREEN
        End If
        .Font.Bold = True
        .Font.Size = 14
    End With
End Sub


' ── Helpers ─────────────────────────────────────────────────────────────────
Private Sub WriteBlockHeader(ws As Worksheet, r As Long, c As Long, _
                               title As String, width As Integer)
    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + width - 1))
        .Merge
        .Value = title
        .Font.Bold = True
        .Font.Size = 9
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .RowHeight = 18
    End With
End Sub


Private Sub WriteDataRow(ws As Worksheet, r As Long, c As Long, label As String, valor As String)
    ws.Cells(r, c).Value = label
    ws.Cells(r, c).Font.Size = 8
    ws.Cells(r, c + 1).Value = valor
    ws.Cells(r, c + 1).Font.Bold = True
    ws.Cells(r, c + 1).Font.Size = 9
    ws.Cells(r, c + 1).HorizontalAlignment = xlRight
End Sub


Private Function SumByMonth(wsDados As Worksheet, rangeKey As String, _
                              colName As String, filterCol As String, filterVal As String) As Double
    Dim rng As Range
    On Error Resume Next
    Set rng = wsDados.Range("DL_" & rangeKey)
    On Error GoTo 0

    If rng Is Nothing Then SumByMonth = 0: Exit Function

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colIdx As Integer: colIdx = 0
    Dim filterColIdx As Integer: filterColIdx = 0
    Dim c As Integer

    For c = 1 To 30
        Dim h As String: h = LCase(wsDados.Cells(headerRow, c).Value)
        If h = LCase(colName) Then colIdx = c
        If h = LCase(filterCol) Then filterColIdx = c
    Next c

    If colIdx = 0 Then SumByMonth = 0: Exit Function

    Dim soma As Double: soma = 0
    Dim rowNum As Long
    For rowNum = rng.Row To rng.Row + rng.Rows.Count - 1
        If filterColIdx > 0 Then
            If CStr(wsDados.Cells(rowNum, filterColIdx).Value) = filterVal Then
                soma = soma + SafeD(wsDados.Cells(rowNum, colIdx).Value)
            End If
        Else
            soma = soma + SafeD(wsDados.Cells(rowNum, colIdx).Value)
        End If
    Next rowNum

    SumByMonth = soma
End Function

Private Function SafeD(val As Variant) As Double
    If IsEmpty(val) Or IsNull(val) Or Not IsNumeric(val) Then
        SafeD = 0
    Else
        SafeD = CDbl(val)
    End If
End Function
