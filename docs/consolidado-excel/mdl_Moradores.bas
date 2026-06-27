Attribute VB_Name = "mdl_Moradores"
'=============================================================================
' Aba: MORADORES — Panorama completo dos moradores
' Perguntas diretriz:
'   "Quem mora aqui e qual é o perfil da comunidade?"
'   "Estamos crescendo? Em quais ruas estamos presentes?"
'   "Quais são os problemas mais relatados pela comunidade?"
'=============================================================================
Option Explicit

Private Const CLR_NAVY     As Long = 2298644   ' #141323 RGB(20,19,35)
Private Const CLR_CERULEAN As Long = 11702536  ' RGB(8,145,178)
Private Const CLR_AMBER    As Long = 761589    ' RGB(245,158,11)
Private Const CLR_WHITE    As Long = 16777215
Private Const CLR_LIGHT    As Long = 16184563  ' RGB(243,244,246)

Public Sub PopulateMoradores()
    Dim ws     As Worksheet
    Dim wsDados As Worksheet

    On Error GoTo ErrHandler

    Set ws = ThisWorkbook.Sheets("MORADORES")
    Set wsDados = ThisWorkbook.Sheets("_DADOS")

    Application.ScreenUpdating = False
    ws.Range("B4:N100").ClearContents

    With ws.Range("B4")
        .Value = ChrW(8220) & "Quem mora aqui e qual é o perfil da comunidade? Estamos crescendo?" & ChrW(8221)
        .Font.Italic = True
        .Font.Color = CLR_CERULEAN
        .Font.Size = 10
    End With

    ' ── KPIs gerais ─────────────────────────────────────────────────────────
    WriteResidentKPIs ws, wsDados

    ' ── Crescimento semanal ──────────────────────────────────────────────────
    WriteGrowthTable ws, wsDados

    ' ── Censo por rua ────────────────────────────────────────────────────────
    WriteCensoByStreet ws, wsDados

    ' ── Problemas da comunidade ──────────────────────────────────────────────
    WriteCommunityProblems ws, wsDados

    Application.ScreenUpdating = True
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    MsgBox "Erro em PopulateMoradores: " & Err.Description, vbCritical
End Sub


Private Sub WriteResidentKPIs(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 6
    Dim c As Long: c = 2

    ' Header
    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 7))
        .Merge
        .Value = "PANORAMA DE MORADORES"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim kpiLabels As Variant
    Dim kpiCols   As Variant
    kpiLabels = Array("Total de Moradores", "Associados", "Visitantes", "Inadimplentes", _
                       "Dependentes", "Ativos (30d)")
    kpiCols   = Array("total", "members", "guests", "delinquent", "dependents", "active_30d")

    Dim i As Integer
    For i = 0 To 5
        Dim val As Variant
        val = mdl_Inicio.GetScalar(wsDados, "MORADORES_TOTAL", CStr(kpiCols(i)), "", "")

        With ws.Cells(r, c + i)
            .Value = kpiLabels(i)
            .Font.Size = 8
            .Font.Bold = True
            .Interior.Color = CLR_CERULEAN
            .Font.Color = CLR_WHITE
        End With
        With ws.Cells(r + 1, c + i)
            .Value = IIf(IsEmpty(val), "–", CStr(val))
            .Font.Bold = True
            .Font.Size = 14
            .Font.Color = CLR_NAVY
            .HorizontalAlignment = xlCenter
        End With
    Next i
End Sub


Private Sub WriteGrowthTable(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 11
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 4))
        .Merge
        .Value = "CRESCIMENTO SEMANAL DE MORADORES"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Semana", "Novos", "Saídas", "Líquido", "Total acumulado")
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
    Set rng = wsDados.Range("DL_CRESCIMENTO")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colMap(4) As Integer
    Dim colNames(4) As String
    colNames(0) = "week"
    colNames(1) = "new_members"
    colNames(2) = "churned"
    colNames(3) = "net_new"
    colNames(4) = "cumulative_total"

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        For i = 0 To 4
            If h = colNames(i) Then colMap(i) = col
        Next i
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 11, rng.Row + rng.Rows.Count - 1)
        For i = 0 To 4
            If colMap(i) > 0 Then
                ws.Cells(r, c + i).Value = wsDados.Cells(rowNum, colMap(i)).Value
            End If
        Next i

        ' Cor do líquido
        If colMap(3) > 0 Then
            Dim net As Variant: net = wsDados.Cells(rowNum, colMap(3)).Value
            If IsNumeric(net) Then
                If CDbl(net) > 0 Then
                    ws.Cells(r, c + 3).Font.Color = RGB(34, 197, 94)
                ElseIf CDbl(net) < 0 Then
                    ws.Cells(r, c + 3).Font.Color = RGB(239, 68, 68)
                End If
            End If
        End If

        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 4)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub


Private Sub WriteCensoByStreet(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 26
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 4))
        .Merge
        .Value = "CENSO POR RUA"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Rua", "Total", "Associados", "Visitantes", "% Assoc.")
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
    Set rng = wsDados.Range("DL_CENSO_RUA")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colMap2(4) As Integer
    Dim colNames2(4) As String
    colNames2(0) = "street"
    colNames2(1) = "total"
    colNames2(2) = "members"
    colNames2(3) = "guests"
    colNames2(4) = "pct_members"

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        For i = 0 To 4
            If h = colNames2(i) Then colMap2(i) = col
        Next i
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 14, rng.Row + rng.Rows.Count - 1)
        For i = 0 To 4
            If colMap2(i) > 0 Then
                Dim cellVal As Variant
                cellVal = wsDados.Cells(rowNum, colMap2(i)).Value
                If i = 4 And IsNumeric(cellVal) Then
                    ws.Cells(r, c + i).Value = Format(CDbl(cellVal), "0.0") & "%"
                Else
                    ws.Cells(r, c + i).Value = cellVal
                End If
            End If
        Next i
        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 4)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub


Private Sub WriteCommunityProblems(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 26
    Dim c As Long: c = 9

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 3))
        .Merge
        .Value = "PROBLEMAS RELATADOS"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_AMBER
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Problema", "Ocorrências", "Última vez", "Status")
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
    Set rng = wsDados.Range("DL_PROBLEMAS")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colProb As Integer: colProb = 0
    Dim colOcorr As Integer: colOcorr = 0
    Dim colUlt As Integer: colUlt = 0
    Dim colStat As Integer: colStat = 0

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        If h = "problem_type" Or h = "problema" Then colProb = col
        If h = "ocorrencias" Or h = "count" Then colOcorr = col
        If h = "last_seen" Or h = "ultima_ocorrencia" Then colUlt = col
        If h = "status" Then colStat = col
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 9, rng.Row + rng.Rows.Count - 1)
        If colProb > 0 Then ws.Cells(r, c).Value = wsDados.Cells(rowNum, colProb).Value
        If colOcorr > 0 Then ws.Cells(r, c + 1).Value = wsDados.Cells(rowNum, colOcorr).Value
        If colUlt > 0 Then ws.Cells(r, c + 2).Value = wsDados.Cells(rowNum, colUlt).Value
        If colStat > 0 Then ws.Cells(r, c + 3).Value = wsDados.Cells(rowNum, colStat).Value

        ws.Cells(r, c + 1).HorizontalAlignment = xlRight
        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 3)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub
