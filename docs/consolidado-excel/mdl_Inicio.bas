Attribute VB_Name = "mdl_Inicio"
'=============================================================================
' Aba: INÍCIO — Panorama Geral
' Pergunta diretriz: "Em uma linha, qual é a saúde da associação hoje?"
'=============================================================================
Option Explicit

' Cores da paleta
Private Const CLR_NAVY    As Long = 888337   ' #0D2137 → RGB(13,33,55)
Private Const CLR_CERULEAN As Long = 11573706 ' #0891B2 → RGB(8,145,178)
Private Const CLR_AMBER   As Long = 1023485   ' #F59E0B → RGB(245,158,11)
Private Const CLR_WHITE   As Long = 16777215
Private Const CLR_LIGHT   As Long = 15921906  ' #F3F4F6
Private Const CLR_GREEN   As Long = 338720    ' #22C55E
Private Const CLR_RED     As Long = 3942400   ' #EF4444

Public Sub PopulateInicio()
    Dim ws As Worksheet
    Dim wsDados As Worksheet

    On Error GoTo ErrHandler

    Set ws = ThisWorkbook.Sheets("INÍCIO")
    Set wsDados = ThisWorkbook.Sheets("_DADOS")

    Application.ScreenUpdating = False

    ' Limpa área de KPIs (mantém cabeçalho fixo formatado)
    ws.Range("B5:M60").ClearContents

    ' ── Linha de pergunta diretriz ───────────────────────────────────────────
    With ws.Range("B4")
        .Value = Chr(8220) & "Em uma linha, qual é a saúde da associação hoje?" & Chr(8221)
        .Font.Italic = True
        .Font.Color = CLR_CERULEAN
        .Font.Size = 10
    End With

    ' ── Bloco 1: Indicadores Financeiros ────────────────────────────────────
    WriteKpiBlock ws, wsDados, "B6", "FINANCEIRO"

    ' ── Bloco 2: Mensalidades ───────────────────────────────────────────────
    WriteKpiBlock ws, wsDados, "G6", "MENSALIDADES"

    ' ── Bloco 3: Moradores ──────────────────────────────────────────────────
    WriteKpiBlock ws, wsDados, "B16", "MORADORES"

    ' ── Bloco 4: Operações ──────────────────────────────────────────────────
    WriteKpiBlock ws, wsDados, "G16", "PACOTES & OS"

    ' ── Alertas críticos ────────────────────────────────────────────────────
    WriteAlerts ws, wsDados, 28

    Application.ScreenUpdating = True
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    MsgBox "Erro em PopulateInicio: " & Err.Description, vbCritical
End Sub


Private Sub WriteKpiBlock(ws As Worksheet, wsDados As Worksheet, _
                           startCell As String, blockTitle As String)
    Dim r As Range
    Set r = ws.Range(startCell)

    ' Título do bloco
    With r
        .Value = blockTitle
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Font.Size = 9
        .Interior.Color = CLR_NAVY
        .RowHeight = 18
    End With

    Dim row As Long
    row = r.Row + 1
    Dim col As Long
    col = r.Column

    Select Case blockTitle
        Case "FINANCEIRO"
            ' Receita do mês corrente
            WriteKpiRow ws, wsDados, row, col, "Receita mês atual", _
                GetScalar(wsDados, "RECEITA_DIARIA", "total_income", "month", Format(Now, "yyyy-mm")), "R$"
            ' Runway (meses de reserva)
            WriteKpiRow ws, wsDados, row + 1, col, "Runway (meses)", _
                GetScalar(wsDados, "RUNWAY", "months_of_runway", "", ""), ""
            ' Taxa de adimplência
            WriteKpiRow ws, wsDados, row + 2, col, "Taxa cobrança mês", _
                GetScalar(wsDados, "TAXA_COBRANCA", "pct_paid", "month", Format(Now, "yyyy-mm")), "%"

        Case "MENSALIDADES"
            WriteKpiRow ws, wsDados, row, col, "Mensalidades pagas", _
                GetScalar(wsDados, "INADIMPLENCIA", "pagas", "", ""), ""
            WriteKpiRow ws, wsDados, row + 1, col, "Mensalidades vencidas", _
                GetScalar(wsDados, "INADIMPLENCIA", "vencidas", "", ""), ""
            WriteKpiRow ws, wsDados, row + 2, col, "Valor inadimplente", _
                GetScalar(wsDados, "INADIMPLENCIA", "total_owed", "", ""), "R$"

        Case "MORADORES"
            WriteKpiRow ws, wsDados, row, col, "Total de moradores", _
                GetScalar(wsDados, "MORADORES_GERAL", "total", "", ""), ""
            WriteKpiRow ws, wsDados, row + 1, col, "Associados ativos", _
                GetScalar(wsDados, "MORADORES_GERAL", "members", "", ""), ""
            WriteKpiRow ws, wsDados, row + 2, col, "Visitantes", _
                GetScalar(wsDados, "MORADORES_GERAL", "guests", "", ""), ""

        Case "PACOTES & OS"
            WriteKpiRow ws, wsDados, row, col, "Pacotes parados +3d", _
                GetScalar(wsDados, "PACOTES_STUCK", "total", "", ""), ""
            WriteKpiRow ws, wsDados, row + 1, col, "OS abertas", _
                GetScalar(wsDados, "KPI_OP", "os_abertas", "", ""), ""
            WriteKpiRow ws, wsDados, row + 2, col, "Tarefas semana", _
                GetScalar(wsDados, "KPI_OP", "tarefas_semana", "", ""), ""
    End Select
End Sub


Private Sub WriteKpiRow(ws As Worksheet, wsDados As Worksheet, _
                         rowNum As Long, colNum As Long, _
                         label As String, valor As Variant, prefix As String)
    With ws.Cells(rowNum, colNum)
        .Value = label
        .Font.Size = 8
        .Font.Color = RGB(75, 85, 99)
        .Interior.Color = CLR_LIGHT
    End With

    Dim displayVal As String
    If IsEmpty(valor) Or IsNull(valor) Or valor = "" Then
        displayVal = "–"
    ElseIf prefix = "R$" Then
        displayVal = "R$ " & Format(CDbl(valor), "#,##0.00")
    ElseIf prefix = "%" Then
        displayVal = Format(CDbl(valor), "0.0") & "%"
    Else
        displayVal = CStr(valor)
    End If

    With ws.Cells(rowNum, colNum + 1)
        .Value = displayVal
        .Font.Bold = True
        .Font.Size = 11
        .Font.Color = CLR_NAVY
        .HorizontalAlignment = xlRight
        .Interior.Color = CLR_LIGHT
    End With
End Sub


Private Sub WriteAlerts(ws As Worksheet, wsDados As Worksheet, startRow As Long)
    With ws.Cells(startRow, 2)
        .Value = "ALERTAS CRÍTICOS"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_RED
        .Font.Size = 9
    End With

    Dim r As Long
    r = startRow + 1

    ' Pacotes parados
    Dim stuck As Variant
    stuck = GetScalar(wsDados, "PACOTES_STUCK", "total", "", "")
    If Not IsEmpty(stuck) And CInt(stuck) > 5 Then
        ws.Cells(r, 2).Value = "⚠ " & stuck & " pacotes parados há mais de 3 dias"
        ws.Cells(r, 2).Font.Color = CLR_RED
        r = r + 1
    End If

    ' Alta inadimplência
    Dim pctPago As Variant
    pctPago = GetScalar(wsDados, "TAXA_COBRANCA", "pct_paid", "month", Format(Now, "yyyy-mm"))
    If Not IsEmpty(pctPago) And CDbl(pctPago) < 60 Then
        ws.Cells(r, 2).Value = "⚠ Taxa de cobrança abaixo de 60% (" & Format(CDbl(pctPago), "0.0") & "%)"
        ws.Cells(r, 2).Font.Color = CLR_RED
        r = r + 1
    End If

    If r = startRow + 1 Then
        ws.Cells(r, 2).Value = "✓ Sem alertas críticos no momento"
        ws.Cells(r, 2).Font.Color = CLR_GREEN
    End If
End Sub


'=============================================================================
' Extrai um valor escalar de um bloco em _DADOS
' rangeKey = nome do bloco (ex: "RECEITA_DIARIA"), colName = coluna desejada
' filterCol/filterVal = filtro opcional (ex: "month", "2026-06")
'=============================================================================
Public Function GetScalar(wsDados As Worksheet, rangeKey As String, _
                           colName As String, filterCol As String, filterVal As String) As Variant
    Dim rng As Range
    On Error Resume Next
    Set rng = wsDados.Range("DL_" & rangeKey)
    On Error GoTo 0

    If rng Is Nothing Then
        GetScalar = Empty
        Exit Function
    End If

    ' Descobre índice das colunas
    Dim headerRow As Long
    headerRow = rng.Row - 1
    Dim colIdx As Integer
    Dim filterColIdx As Integer
    colIdx = 0
    filterColIdx = 0
    Dim c As Integer

    For c = 1 To 50
        Dim hdr As String
        hdr = LCase(wsDados.Cells(headerRow, c).Value)
        If hdr = LCase(colName) Then colIdx = c
        If Len(filterCol) > 0 And hdr = LCase(filterCol) Then filterColIdx = c
        If colIdx > 0 And (Len(filterCol) = 0 Or filterColIdx > 0) Then Exit For
    Next c

    If colIdx = 0 Then GetScalar = Empty: Exit Function

    ' Varre linhas do range
    Dim i As Long
    For i = rng.Row To rng.Row + rng.Rows.Count - 1
        If filterColIdx > 0 Then
            If CStr(wsDados.Cells(i, filterColIdx).Value) = filterVal Then
                GetScalar = wsDados.Cells(i, colIdx).Value
                Exit Function
            End If
        Else
            GetScalar = wsDados.Cells(i, colIdx).Value
            Exit Function
        End If
    Next i

    GetScalar = Empty
End Function
