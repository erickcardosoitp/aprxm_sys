Attribute VB_Name = "mdl_Pacotes"
'=============================================================================
' Aba: PACOTES — Logística de entrega
' Perguntas diretriz:
'   "Quantos pacotes estão parados e há quanto tempo?"
'   "Qual é o nosso SLA de entrega?"
'   "Quem são os moradores com mais pacotes não retirados?"
'=============================================================================
Option Explicit

Private Const CLR_NAVY     As Long = 2298644   ' #141323 RGB(20,19,35)
Private Const CLR_CERULEAN As Long = 11702536  ' RGB(8,145,178)
Private Const CLR_AMBER    As Long = 761589    ' RGB(245,158,11)
Private Const CLR_WHITE    As Long = 16777215
Private Const CLR_LIGHT    As Long = 16184563  ' RGB(243,244,246)
Private Const CLR_GREEN    As Long = 4891414   ' RGB(22,163,74)
Private Const CLR_RED      As Long = 2498780   ' RGB(220,38,38)

Public Sub PopulatePacotes()
    Dim ws     As Worksheet
    Dim wsDados As Worksheet

    On Error GoTo ErrHandler

    Set ws = ThisWorkbook.Sheets("PACOTES")
    Set wsDados = ThisWorkbook.Sheets("_DADOS")

    Application.ScreenUpdating = False
    ws.Range("B4:N100").ClearContents

    With ws.Range("B4")
        .Value = ChrW(8220) & "Quantos pacotes estão parados? Qual é o nosso SLA de entrega?" & ChrW(8221)
        .Font.Italic = True
        .Font.Color = CLR_CERULEAN
        .Font.Size = 10
    End With

    WritePacotesKPIs ws, wsDados
    WriteStuckPackages ws, wsDados
    WriteSLAByType ws, wsDados
    WriteResidentRanking ws, wsDados

    Application.ScreenUpdating = True
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    MsgBox "Erro em PopulatePacotes: " & Err.Description, vbCritical
End Sub


Private Sub WritePacotesKPIs(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 6
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 5))
        .Merge
        .Value = "SITUAÇÃO ATUAL DOS PACOTES"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim kpiLabels As Variant
    Dim kpiCols   As Variant
    kpiLabels = Array("Parados (+3 dias)", "Aguardando Retirada", "Entregues (7d)", "Devolvidos (7d)", "Taxa Entrega %", "Taxa Devolução %")
    kpiCols   = Array("stuck_3d", "total_waiting", "delivered_7d", "returned_7d", "delivery_rate_pct", "return_rate_pct")

    Dim i As Integer
    For i = 0 To 5
        Dim val As Variant
        val = mdl_Inicio.GetScalar(wsDados, "PACOTES_STUCK", CStr(kpiCols(i)), "", "")

        With ws.Cells(r, c + i)
            .Value = kpiLabels(i)
            .Font.Size = 8
            .Font.Bold = True
            .Interior.Color = IIf(i = 0, CLR_RED, CLR_CERULEAN)
            .Font.Color = CLR_WHITE
        End With

        Dim displayVal As String
        If IsEmpty(val) Then
            displayVal = "–"
        ElseIf i >= 4 Then
            displayVal = Format(CDbl(val), "0.0") & "%"
        Else
            displayVal = CStr(val)
        End If

        With ws.Cells(r + 1, c + i)
            .Value = displayVal
            .Font.Bold = True
            .Font.Size = 14
            If i = 0 And IsNumeric(val) And CDbl(val) > 5 Then
                .Font.Color = CLR_RED
            ElseIf i = 4 And IsNumeric(val) And CDbl(val) >= 80 Then
                .Font.Color = CLR_GREEN
            Else
                .Font.Color = CLR_NAVY
            End If
            .HorizontalAlignment = xlCenter
        End With
    Next i
End Sub


Private Sub WriteStuckPackages(ws As Worksheet, wsDados As Worksheet)
    ' NOTA: packages_stuck gold table é agregada (total por associação), não por pacote.
    ' Para detalhe por pacote pendente, usamos resident_package_ranking (pending_now > 0).
    Dim r As Long: r = 11
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 5))
        .Merge
        .Value = "MORADORES COM PACOTES PENDENTES (+ TEMPO DE ESPERA)"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_RED
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Morador", "Tipo", "Rua", "Pacotes aguardando", "Total recebidos", "Tempo médio (h)")
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

    ' Usa RANK_MORADORES filtrado por pending_now > 0
    Dim rng As Range
    On Error Resume Next
    Set rng = wsDados.Range("DL_RANK_MORADORES")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados de pacotes pendentes)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colName    As Integer: colName = 0
    Dim colType    As Integer: colType = 0
    Dim colStreet  As Integer: colStreet = 0
    Dim colWaiting As Integer: colWaiting = 0
    Dim colTotal   As Integer: colTotal = 0
    Dim colAvgWait As Integer: colAvgWait = 0

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        If h = "resident_name"   Then colName    = col
        If h = "resident_type"   Then colType    = col
        If h = "street"          Then colStreet  = col
        If h = "waiting"         Then colWaiting = col
        If h = "total_received"  Then colTotal   = col
        If h = "avg_wait_hours"  Then colAvgWait = col
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    Dim countShown As Integer: countShown = 0

    For rowNum = rng.Row To rng.Row + rng.Rows.Count - 1
        ' Filtra apenas quem tem pacote aguardando
        If colWaiting > 0 Then
            Dim waitingVal As Variant
            waitingVal = wsDados.Cells(rowNum, colWaiting).Value
            If Not IsNumeric(waitingVal) Then GoTo NextPkgRow
            If CLng(waitingVal) = 0 Then GoTo NextPkgRow
        End If

        If colName > 0    Then ws.Cells(r, c).Value     = wsDados.Cells(rowNum, colName).Value
        If colType > 0    Then ws.Cells(r, c + 1).Value = wsDados.Cells(rowNum, colType).Value
        If colStreet > 0  Then ws.Cells(r, c + 2).Value = wsDados.Cells(rowNum, colStreet).Value
        If colWaiting > 0 Then
            ws.Cells(r, c + 3).Value = wsDados.Cells(rowNum, colWaiting).Value
            ws.Cells(r, c + 3).Font.Bold = True
            If CLng(waitingVal) >= 3 Then ws.Cells(r, c + 3).Font.Color = CLR_RED
        End If
        If colTotal > 0   Then ws.Cells(r, c + 4).Value = wsDados.Cells(rowNum, colTotal).Value
        If colAvgWait > 0 Then
            Dim avgH As Variant: avgH = wsDados.Cells(rowNum, colAvgWait).Value
            ws.Cells(r, c + 5).Value = IIf(IsNumeric(avgH), Format(CDbl(avgH), "0.0"), "–")
        End If

        Dim i2 As Integer
        For i2 = 0 To 5: ws.Cells(r, c + i2).Font.Size = 8: Next i2
        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 5)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
        countShown = countShown + 1
        If countShown >= 15 Then Exit For

NextPkgRow:
    Next rowNum

    If countShown = 0 Then
        ws.Cells(r, c).Value = Chr(10003) & "  Nenhum pacote aguardando retirada"
        ws.Cells(r, c).Font.Color = CLR_GREEN
        ws.Cells(r, c).Font.Bold = True
    End If
End Sub


Private Sub WriteSLAByType(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 11
    Dim c As Long: c = 9

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 3))
        .Merge
        .Value = "SLA POR TIPO DE PACOTE"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Semana", "Tipo", "% no Prazo", "Tempo Médio (d)")
    Dim i As Integer
    For i = 0 To 3
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
    Set rng = wsDados.Range("DL_SLA_TIPO")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colMap2(3) As Integer
    Dim colNames2(3) As String
    colNames2(0) = "week"
    colNames2(1) = "package_type"
    colNames2(2) = "pct_on_time"
    colNames2(3) = "avg_days"

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        For i = 0 To 3
            If h = colNames2(i) Then colMap2(i) = col
        Next i
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 11, rng.Row + rng.Rows.Count - 1)
        For i = 0 To 3
            If colMap2(i) > 0 Then
                Dim v As Variant
                v = wsDados.Cells(rowNum, colMap2(i)).Value
                If i = 2 Then
                    ws.Cells(r, c + i).Value = IIf(IsNumeric(v), Format(CDbl(v), "0.0") & "%", v)
                    If IsNumeric(v) Then
                        ws.Cells(r, c + i).Font.Color = IIf(CDbl(v) >= 80, CLR_GREEN, IIf(CDbl(v) >= 60, CLR_AMBER, CLR_RED))
                    End If
                Else
                    ws.Cells(r, c + i).Value = v
                End If
                ws.Cells(r, c + i).Font.Size = 8
            End If
        Next i
        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 3)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub


Private Sub WriteResidentRanking(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 27
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 3))
        .Merge
        .Value = "MORADORES COM MAIS PACOTES NÃO RETIRADOS"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_AMBER
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Morador", "Pacotes aguardando", "Total recebidos", "Rua")
    Dim i As Integer
    For i = 0 To 3
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
    Set rng = wsDados.Range("DL_RANK_MORADORES")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colMap3(3) As Integer
    Dim colNames3(3) As String
    colNames3(0) = "resident_name"
    colNames3(1) = "waiting"
    colNames3(2) = "total_received"
    colNames3(3) = "street"

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        For i = 0 To 3
            If h = colNames3(i) Then colMap3(i) = col
        Next i
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 9, rng.Row + rng.Rows.Count - 1)
        For i = 0 To 3
            If colMap3(i) > 0 Then
                ws.Cells(r, c + i).Value = wsDados.Cells(rowNum, colMap3(i)).Value
                ws.Cells(r, c + i).Font.Size = 8
            End If
        Next i
        ' Destaque se waiting > 3
        If colMap3(1) > 0 Then
            Dim waiting As Variant
            waiting = wsDados.Cells(rowNum, colMap3(1)).Value
            If IsNumeric(waiting) And CDbl(waiting) > 3 Then
                ws.Cells(r, c + 1).Font.Color = CLR_RED
                ws.Cells(r, c + 1).Font.Bold = True
            End If
        End If
        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 3)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub
