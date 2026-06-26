Attribute VB_Name = "mdl_Senso"
'=============================================================================
' Aba: SENSO — Senso da Comunidade
' Pergunta diretriz:
'   "O que a comunidade está sentindo e o que mais preocupa os moradores?"
'
' Nota: esta aba consolida dados de problemas, censo e uso do sistema
' para dar à diretoria uma visão qualitativa da comunidade
'=============================================================================
Option Explicit

Private Const CLR_NAVY     As Long = 888337
Private Const CLR_CERULEAN As Long = 11573706
Private Const CLR_AMBER    As Long = 1023485
Private Const CLR_WHITE    As Long = 16777215
Private Const CLR_LIGHT    As Long = 15921906

Public Sub PopulateSenso()
    Dim ws     As Worksheet
    Dim wsDados As Worksheet

    On Error GoTo ErrHandler

    Set ws = ThisWorkbook.Sheets("SENSO")
    Set wsDados = ThisWorkbook.Sheets("_DADOS")

    Application.ScreenUpdating = False
    ws.Range("B4:N100").ClearContents

    With ws.Range("B4")
        .Value = Chr(8220) & "O que a comunidade está sentindo? O que mais preocupa os moradores?" & Chr(8221)
        .Font.Italic = True
        .Font.Color = CLR_CERULEAN
        .Font.Size = 10
    End With

    WriteSensoKPIs ws, wsDados
    WriteProblemasPorCategoria ws, wsDados
    WriteCensoVisual ws, wsDados
    WriteEngajamento ws, wsDados

    Application.ScreenUpdating = True
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    MsgBox "Erro em PopulateSenso: " & Err.Description, vbCritical
End Sub


Private Sub WriteSensoKPIs(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 6
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 5))
        .Merge
        .Value = "INDICADORES DA COMUNIDADE"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    ' KPIs relevantes para o senso
    Dim lbls(5) As String
    Dim cols(5) As String
    Dim sources(5) As String

    lbls(0) = "Total de Moradores": cols(0) = "total":          sources(0) = "MORADORES_GERAL"
    lbls(1) = "Ruas Atendidas":     cols(1) = "total_streets":  sources(1) = "MORADORES_GERAL"
    lbls(2) = "Problemas Abertos":  cols(2) = "total":          sources(2) = "PROBLEMAS"
    lbls(3) = "Ocorrências (30d)":  cols(3) = "ocorrencias":    sources(3) = "PROBLEMAS"
    lbls(4) = "Novos (esta sem.)":  cols(4) = "new_members":    sources(4) = "CRESCIMENTO"
    lbls(5) = "% Assoc. vs Total":  cols(5) = "pct_members":    sources(5) = "CENSO_RUA"

    Dim i As Integer
    For i = 0 To 5
        Dim val As Variant
        val = mdl_Inicio.GetScalar(wsDados, sources(i), cols(i), "", "")

        With ws.Cells(r, c + i)
            .Value = lbls(i)
            .Font.Size = 8
            .Font.Bold = True
            .Interior.Color = CLR_CERULEAN
            .Font.Color = CLR_WHITE
        End With

        With ws.Cells(r + 1, c + i)
            If IsEmpty(val) Then
                .Value = "–"
            ElseIf i = 5 And IsNumeric(val) Then
                .Value = Format(CDbl(val), "0.0") & "%"
            Else
                .Value = CStr(val)
            End If
            .Font.Bold = True
            .Font.Size = 14
            .Font.Color = CLR_NAVY
            .HorizontalAlignment = xlCenter
        End With
    Next i
End Sub


Private Sub WriteProblemasPorCategoria(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 11
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 4))
        .Merge
        .Value = "PROBLEMAS MAIS RELATADOS PELA COMUNIDADE"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_AMBER
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Categoria", "Ocorrências", "Última Vez", "Status", "Tendência")
    Dim i As Integer
    For i = 0 To 4
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
    Set rng = wsDados.Range("DL_PROBLEMAS")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem problemas registrados)"
        ws.Cells(r, c).Font.Color = CLR_NAVY
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colMap(4) As Integer
    Dim colNames(4) As String
    colNames(0) = "problem_type"
    colNames(1) = "ocorrencias"
    colNames(2) = "last_seen"
    colNames(3) = "status"
    colNames(4) = "trend"

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        For i = 0 To 4
            If h = colNames(i) Or h = "problema" Or h = "count" Then
                If h = "problema" And i = 0 Then colMap(0) = col
                If h = "count" And i = 1 Then colMap(1) = col
                If h = colNames(i) Then colMap(i) = col
            End If
        Next i
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 12, rng.Row + rng.Rows.Count - 1)
        For i = 0 To 4
            If colMap(i) > 0 Then
                ws.Cells(r, c + i).Value = wsDados.Cells(rowNum, colMap(i)).Value
                ws.Cells(r, c + i).Font.Size = 8
            End If
        Next i

        ' Destaque ocorrências altas
        If colMap(1) > 0 Then
            Dim ocorr As Variant
            ocorr = wsDados.Cells(rowNum, colMap(1)).Value
            If IsNumeric(ocorr) And CDbl(ocorr) >= 5 Then
                ws.Cells(r, c + 1).Font.Bold = True
                ws.Cells(r, c + 1).Font.Color = RGB(239, 68, 68)
            End If
        End If

        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 4)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub


Private Sub WriteCensoVisual(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 11
    Dim c As Long: c = 9

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 3))
        .Merge
        .Value = "PRESENÇA POR RUA (TOP 10)"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Rua", "Moradores", "Assoc.", "% Assoc.")
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
    Set rng = wsDados.Range("DL_CENSO_RUA")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colStreet As Integer: colStreet = 0
    Dim colTotal As Integer: colTotal = 0
    Dim colMembros As Integer: colMembros = 0
    Dim colPct As Integer: colPct = 0

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        If h = "street" Then colStreet = col
        If h = "total" Then colTotal = col
        If h = "members" Then colMembros = col
        If h = "pct_members" Then colPct = col
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 9, rng.Row + rng.Rows.Count - 1)
        If colStreet > 0 Then ws.Cells(r, c).Value = wsDados.Cells(rowNum, colStreet).Value
        If colTotal > 0 Then ws.Cells(r, c + 1).Value = wsDados.Cells(rowNum, colTotal).Value
        If colMembros > 0 Then ws.Cells(r, c + 2).Value = wsDados.Cells(rowNum, colMembros).Value
        If colPct > 0 Then
            Dim pct As Variant
            pct = wsDados.Cells(rowNum, colPct).Value
            ws.Cells(r, c + 3).Value = IIf(IsNumeric(pct), Format(CDbl(pct), "0.0") & "%", pct)
            If IsNumeric(pct) Then
                ws.Cells(r, c + 3).Font.Color = IIf(CDbl(pct) >= 60, RGB(34, 197, 94), IIf(CDbl(pct) >= 40, CLR_AMBER, RGB(239, 68, 68)))
            End If
        End If
        For i = 0 To 3
            ws.Cells(r, c + i).Font.Size = 8
        Next i
        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 3)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub


Private Sub WriteEngajamento(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 27
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 5))
        .Merge
        .Value = "ENGAJAMENTO — CRESCIMENTO SEMANAL (ÚLTIMAS 8 SEMANAS)"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Semana", "Total Moradores", "Novos", "Saídas", "Líquido", "Acumulado")
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
    Set rng = wsDados.Range("DL_CRESCIMENTO")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados de crescimento)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colMap(5) As Integer
    Dim colNames(5) As String
    colNames(0) = "week"
    colNames(1) = "total_members"
    colNames(2) = "new_members"
    colNames(3) = "churned"
    colNames(4) = "net_new"
    colNames(5) = "cumulative_total"

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        For i = 0 To 5
            If h = colNames(i) Then colMap(i) = col
        Next i
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 7, rng.Row + rng.Rows.Count - 1)
        For i = 0 To 5
            If colMap(i) > 0 Then
                ws.Cells(r, c + i).Value = wsDados.Cells(rowNum, colMap(i)).Value
                ws.Cells(r, c + i).Font.Size = 8
            End If
        Next i

        ' Cor do líquido
        If colMap(4) > 0 Then
            Dim net As Variant
            net = wsDados.Cells(rowNum, colMap(4)).Value
            If IsNumeric(net) Then
                If CDbl(net) > 0 Then ws.Cells(r, c + 4).Font.Color = RGB(34, 197, 94)
                ElseIf CDbl(net) < 0 Then ws.Cells(r, c + 4).Font.Color = RGB(239, 68, 68)
            End If
        End If

        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 5)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub
