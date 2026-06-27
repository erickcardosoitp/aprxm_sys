Attribute VB_Name = "mdl_Mensalidades"
'=============================================================================
' Aba: MENSALIDADES — Gestão de cobranças e inadimplência
' Perguntas diretriz:
'   "Quantos moradores estão pagando em dia?"
'   "Em quais ruas está a maior inadimplência?"
'   "Qual é o valor total que ainda precisa ser cobrado?"
'=============================================================================
Option Explicit

Private Const CLR_NAVY     As Long = 2298644   ' #141323 RGB(20,19,35)
Private Const CLR_CERULEAN As Long = 11702536  ' RGB(8,145,178)
Private Const CLR_AMBER    As Long = 761589    ' RGB(245,158,11)
Private Const CLR_WHITE    As Long = 16777215
Private Const CLR_LIGHT    As Long = 16184563  ' RGB(243,244,246)
Private Const CLR_GREEN    As Long = 4891414   ' RGB(22,163,74)
Private Const CLR_RED      As Long = 2498780   ' RGB(220,38,38)

Public Sub PopulateMensalidades()
    Dim ws     As Worksheet
    Dim wsDados As Worksheet

    On Error GoTo ErrHandler

    Set ws = ThisWorkbook.Sheets("MENSALIDADES")
    Set wsDados = ThisWorkbook.Sheets("_DADOS")

    Application.ScreenUpdating = False
    ws.Range("B4:N100").ClearContents

    With ws.Range("B4")
        .Value = ChrW(8220) & "Quantos moradores pagam em dia? Em quais ruas está a maior inadimplência?" & ChrW(8221)
        .Font.Italic = True
        .Font.Color = CLR_CERULEAN
        .Font.Size = 10
    End With

    WriteMensalidadeKPIs ws, wsDados
    WriteCobrancaTaxa ws, wsDados
    WriteCobrancaByStreet ws, wsDados
    WriteInadimplenciaRanking ws, wsDados

    Application.ScreenUpdating = True
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    MsgBox "Erro em PopulateMensalidades: " & Err.Description, vbCritical
End Sub


Private Sub WriteMensalidadeKPIs(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 6
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 7))
        .Merge
        .Value = "SITUAÇÃO ATUAL DAS MENSALIDADES"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim kpiLabels As Variant
    Dim kpiCols   As Variant
    kpiLabels = Array("Pagas", "Pendentes", "Vencidas", "Em Acordo", "Isentas", "Valor Pago (R$)", "Valor Inadimplente (R$)", "Total Gerado (R$)")
    kpiCols   = Array("pagas", "pendentes", "vencidas", "acordos", "isentas", "valor_pago", "total_owed", "valor_total")

    Dim i As Integer
    For i = 0 To 7
        Dim val As Variant
        val = mdl_Inicio.GetScalar(wsDados, "INADIMPLENCIA", CStr(kpiCols(i)), "", "")

        With ws.Cells(r, c + i)
            .Value = kpiLabels(i)
            .Font.Size = 8
            .Font.Bold = True
            .Interior.Color = CLR_CERULEAN
            .Font.Color = CLR_WHITE
        End With

        Dim displayVal As String
        If IsEmpty(val) Then
            displayVal = "–"
        ElseIf i >= 5 Then
            displayVal = "R$ " & Format(CDbl(val), "#,##0.00")
        Else
            displayVal = CStr(val)
        End If

        With ws.Cells(r + 1, c + i)
            .Value = displayVal
            .Font.Bold = True
            .Font.Size = 12
            Select Case i
                Case 0: .Font.Color = CLR_GREEN
                Case 2: .Font.Color = CLR_RED
                Case 6: .Font.Color = CLR_RED
                Case Else: .Font.Color = CLR_NAVY
            End Select
            .HorizontalAlignment = xlCenter
        End With
    Next i
End Sub


Private Sub WriteCobrancaTaxa(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 11
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 5))
        .Merge
        .Value = "TAXA DE COBRANÇA MENSAL"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Mês", "Total Gerado", "Total Pago", "% Pago", "Pendentes", "Vencidas")
    Dim i As Integer
    For i = 0 To 5
        With ws.Cells(r, c + i)
            .Value = hdrs(i)
            .Font.Bold = True
            .Font.Size = 8
            .Interior.Color = CLR_CERULEAN
            .Font.Color = CLR_WHITE
        End With
    Next i
    r = r + 1

    Dim rng As Range
    On Error Resume Next
    Set rng = wsDados.Range("DL_TAXA_COBRANCA")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colMap(5) As Integer
    Dim colNames(5) As String
    colNames(0) = "month"
    colNames(1) = "total_gerado"
    colNames(2) = "total_pago"
    colNames(3) = "pct_paid"
    colNames(4) = "pendentes"
    colNames(5) = "vencidas"

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        For i = 0 To 5
            If h = colNames(i) Then colMap(i) = col
        Next i
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 5, rng.Row + rng.Rows.Count - 1)
        For i = 0 To 5
            If colMap(i) > 0 Then
                Dim cellVal As Variant
                cellVal = wsDados.Cells(rowNum, colMap(i)).Value
                Select Case i
                    Case 1, 2
                        ws.Cells(r, c + i).Value = IIf(IsNumeric(cellVal), "R$ " & Format(CDbl(cellVal), "#,##0.00"), cellVal)
                    Case 3
                        ws.Cells(r, c + i).Value = IIf(IsNumeric(cellVal), Format(CDbl(cellVal), "0.0") & "%", cellVal)
                        If IsNumeric(cellVal) Then
                            If CDbl(cellVal) >= 80 Then
                                ws.Cells(r, c + i).Font.Color = CLR_GREEN
                            ElseIf CDbl(cellVal) >= 60 Then
                                ws.Cells(r, c + i).Font.Color = CLR_AMBER
                            Else
                                ws.Cells(r, c + i).Font.Color = CLR_RED
                            End If
                        End If
                    Case Else
                        ws.Cells(r, c + i).Value = cellVal
                End Select
                ws.Cells(r, c + i).Font.Size = 8
            End If
        Next i
        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 5)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub


Private Sub WriteCobrancaByStreet(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 21
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 6))
        .Merge
        .Value = "COBRANÇAS POR RUA (MÊS ATUAL)"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Rua", "Total", "Pagas", "Pendentes", "Vencidas", "Valor Total", "% Pago")
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

    Dim mesAtual As String: mesAtual = Format(Now, "yyyy-mm")

    Dim rng As Range
    On Error Resume Next
    Set rng = wsDados.Range("DL_COBRANCA_RUA")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colMap2(6) As Integer
    Dim colNames2(6) As String
    colNames2(0) = "street"
    colNames2(1) = "total"
    colNames2(2) = "pagas"
    colNames2(3) = "pendentes"
    colNames2(4) = "vencidas"
    colNames2(5) = "valor_total"
    colNames2(6) = "taxa_pct"
    ' também procura month para filtrar
    Dim colMonth As Integer: colMonth = 0

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        For i = 0 To 6
            If h = colNames2(i) Then colMap2(i) = col
        Next i
        If h = "month" Then colMonth = col
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To rng.Row + rng.Rows.Count - 1
        ' Filtra pelo mês atual
        If colMonth > 0 Then
            If CStr(wsDados.Cells(rowNum, colMonth).Value) <> mesAtual Then
                ' Pula (dados vêm ORDER BY month DESC, então na 1ª mudança de mês, saímos)
                If r > 24 Then Exit For
                GoTo NextRow
            End If
        End If

        For i = 0 To 6
            If colMap2(i) > 0 Then
                Dim v As Variant
                v = wsDados.Cells(rowNum, colMap2(i)).Value
                Select Case i
                    Case 5: ws.Cells(r, c + i).Value = IIf(IsNumeric(v), "R$ " & Format(CDbl(v), "#,##0.00"), v)
                    Case 6:
                        ws.Cells(r, c + i).Value = IIf(IsNumeric(v), Format(CDbl(v), "0.0") & "%", v)
                        If IsNumeric(v) Then
                            If CDbl(v) >= 80 Then ws.Cells(r, c + i).Font.Color = CLR_GREEN
                            ElseIf CDbl(v) >= 50 Then ws.Cells(r, c + i).Font.Color = CLR_AMBER
                            Else ws.Cells(r, c + i).Font.Color = CLR_RED
                        End If
                    Case Else: ws.Cells(r, c + i).Value = v
                End Select
                ws.Cells(r, c + i).Font.Size = 8
            End If
        Next i

        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 6)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
        If r > 21 + 20 Then Exit For

NextRow:
    Next rowNum
End Sub


Private Sub WriteInadimplenciaRanking(ws As Worksheet, wsDados As Worksheet)
    ' ATENÇÃO: usa DL_INADIMPL_PESSOAS (lista por pessoa), NÃO DL_INADIMPLENCIA (agregado)
    Dim r As Long: r = 21
    Dim c As Long: c = 11

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 2))
        .Merge
        .Value = "MAIORES DEVEDORES"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_RED
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Morador", "Meses em aberto", "Valor (R$)")
    Dim i As Integer
    For i = 0 To 2
        With ws.Cells(r, c + i)
            .Value = hdrs(i)
            .Font.Bold = True
            .Font.Size = 8
            .Interior.Color = CLR_CERULEAN
            .Font.Color = CLR_WHITE
        End With
    Next i
    r = r + 1

    ' INADIMPL_PESSOAS = delinquency_report por pessoa (full_name, overdue_months, total_owed)
    Dim rng As Range
    On Error Resume Next
    Set rng = wsDados.Range("DL_INADIMPL_PESSOAS")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados de inadimplência por pessoa)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colName   As Integer: colName = 0
    Dim colMonths As Integer: colMonths = 0
    Dim colOwed   As Integer: colOwed = 0

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        If h = "resident_name"  Then colName   = col
        If h = "months_overdue" Then colMonths = col
        If h = "total_owed"     Then colOwed   = col
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 9, rng.Row + rng.Rows.Count - 1)
        If colName > 0 Then
            ws.Cells(r, c).Value = wsDados.Cells(rowNum, colName).Value
            ws.Cells(r, c).Font.Size = 8
        End If
        If colMonths > 0 Then
            ws.Cells(r, c + 1).Value = wsDados.Cells(rowNum, colMonths).Value
            ws.Cells(r, c + 1).HorizontalAlignment = xlCenter
            ws.Cells(r, c + 1).Font.Size = 8
        End If
        If colOwed > 0 Then
            Dim owed As Variant
            owed = wsDados.Cells(rowNum, colOwed).Value
            ws.Cells(r, c + 2).Value = IIf(IsNumeric(owed), "R$ " & Format(CDbl(owed), "#,##0.00"), owed)
            ws.Cells(r, c + 2).Font.Color = CLR_RED
            ws.Cells(r, c + 2).HorizontalAlignment = xlRight
            ws.Cells(r, c + 2).Font.Size = 8
        End If
        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 2)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub
