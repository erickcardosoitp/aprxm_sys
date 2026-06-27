Attribute VB_Name = "mdl_OS"
'=============================================================================
' Aba: OS — Ordens de Serviço e Equipe
' Perguntas diretriz:
'   "Quem é o colaborador mais produtivo esta semana?"
'   "Quantas tarefas foram concluídas vs abertas?"
'   "Há gargalos na execução das ordens de serviço?"
'=============================================================================
Option Explicit

Private Const CLR_NAVY     As Long = 2298644   ' #141323 RGB(20,19,35)
Private Const CLR_CERULEAN As Long = 11702536  ' RGB(8,145,178)
Private Const CLR_AMBER    As Long = 761589    ' RGB(245,158,11)
Private Const CLR_WHITE    As Long = 16777215
Private Const CLR_LIGHT    As Long = 16184563  ' RGB(243,244,246)
Private Const CLR_GREEN    As Long = 4891414   ' RGB(22,163,74)
Private Const CLR_RED      As Long = 2498780   ' RGB(220,38,38)

Public Sub PopulateOS()
    Dim ws     As Worksheet
    Dim wsDados As Worksheet

    On Error GoTo ErrHandler

    Set ws = ThisWorkbook.Sheets("OS")
    Set wsDados = ThisWorkbook.Sheets("_DADOS")

    Application.ScreenUpdating = False
    ws.Range("B4:N100").ClearContents

    With ws.Range("B4")
        .Value = ChrW(8220) & "Quem é o colaborador mais produtivo? Há gargalos nas ordens de serviço?" & ChrW(8221)
        .Font.Italic = True
        .Font.Color = CLR_CERULEAN
        .Font.Size = 10
    End With

    WriteOSKPIs ws, wsDados
    WriteOperatorPerformance ws, wsDados
    WriteWeeklyTasks ws, wsDados
    WriteCashBreaks ws, wsDados

    Application.ScreenUpdating = True
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    MsgBox "Erro em PopulateOS: " & Err.Description, vbCritical
End Sub


Private Sub WriteOSKPIs(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 6
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 5))
        .Merge
        .Value = "KPIs OPERACIONAIS DA SEMANA"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim kpiLabels As Variant
    Dim kpiCols   As Variant
    kpiLabels = Array("OS Abertas", "OS Concluídas", "Tarefas Semana", "Concluídas", "Quebras Caixa", "Sangrias")
    kpiCols   = Array("os_abertas", "os_concluidas", "tarefas_semana", "tarefas_concluidas", "quebras_caixa", "sangrias")

    Dim i As Integer
    For i = 0 To 5
        Dim val As Variant
        val = mdl_Inicio.GetScalar(wsDados, "KPI_OP", CStr(kpiCols(i)), "", "")

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


Private Sub WriteOperatorPerformance(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 11
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 5))
        .Merge
        .Value = "PERFORMANCE DOS OPERADORES"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Operador", "Pacotes Receb.", "Encaminhados", "% Enc./Receb.", "Receita Gerada", "Atividade (dias)")
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
    Set rng = wsDados.Range("DL_OP_PERFORMANCE")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colMap(5) As Integer
    Dim colNames(5) As String
    colNames(0) = "operator_name"
    colNames(1) = "packages_received"
    colNames(2) = "packages_forwarded"
    colNames(3) = "enc_recv_pct"
    colNames(4) = "revenue_generated"
    colNames(5) = "active_days"

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        For i = 0 To 5
            If h = colNames(i) Or h = "enc_recv" Then
                If h = "enc_recv" Then colMap(3) = col Else colMap(i) = col
            End If
        Next i
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 9, rng.Row + rng.Rows.Count - 1)
        Dim operName As String
        If colMap(0) > 0 Then operName = CStr(wsDados.Cells(rowNum, colMap(0)).Value)
        If Len(Trim(operName)) = 0 Then Exit For

        For i = 0 To 5
            If colMap(i) > 0 Then
                Dim v As Variant
                v = wsDados.Cells(rowNum, colMap(i)).Value
                Select Case i
                    Case 3: ws.Cells(r, c + i).Value = IIf(IsNumeric(v), Format(CDbl(v), "0.0") & "%", v)
                    Case 4: ws.Cells(r, c + i).Value = IIf(IsNumeric(v), "R$ " & Format(CDbl(v), "#,##0.00"), v)
                    Case Else: ws.Cells(r, c + i).Value = v
                End Select
                ws.Cells(r, c + i).Font.Size = 8
            End If
        Next i

        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 5)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub


Private Sub WriteWeeklyTasks(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 25
    Dim c As Long: c = 2

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 4))
        .Merge
        .Value = "TAREFAS POR COLABORADOR"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Colaborador", "Concluídas", "Em andamento", "Atrasadas", "Taxa conclusão %")
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
    Set rng = wsDados.Range("DL_RANK_COLAB")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem dados)"
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colMap2(4) As Integer
    Dim colNames2(4) As String
    colNames2(0) = "collaborator_name"
    colNames2(1) = "concluidas"
    colNames2(2) = "em_andamento"
    colNames2(3) = "atrasadas"
    colNames2(4) = "taxa_conclusao"

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        For i = 0 To 4
            If h = colNames2(i) Then colMap2(i) = col
        Next i
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 9, rng.Row + rng.Rows.Count - 1)
        For i = 0 To 4
            If colMap2(i) > 0 Then
                Dim v As Variant
                v = wsDados.Cells(rowNum, colMap2(i)).Value
                If i = 4 Then
                    ws.Cells(r, c + i).Value = IIf(IsNumeric(v), Format(CDbl(v), "0.0") & "%", v)
                    If IsNumeric(v) Then
                        ws.Cells(r, c + i).Font.Color = IIf(CDbl(v) >= 80, CLR_GREEN, IIf(CDbl(v) >= 50, CLR_AMBER, CLR_RED))
                    End If
                Else
                    ws.Cells(r, c + i).Value = v
                End If
                ws.Cells(r, c + i).Font.Size = 8
            End If
        Next i
        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 4)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub


Private Sub WriteCashBreaks(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 25
    Dim c As Long: c = 9

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 2))
        .Merge
        .Value = "QUEBRAS DE CAIXA"
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_AMBER
        .Font.Size = 9
        .RowHeight = 18
    End With
    r = r + 1

    Dim hdrs As Variant
    hdrs = Array("Semana", "Operador", "Diferença (R$)")
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

    Dim rng As Range
    On Error Resume Next
    Set rng = wsDados.Range("DL_QUEBRAS_CAIXA")
    On Error GoTo 0
    If rng Is Nothing Then
        ws.Cells(r, c).Value = "(sem quebras registradas)"
        ws.Cells(r, c).Font.Color = CLR_GREEN
        Exit Sub
    End If

    Dim headerRow As Long: headerRow = rng.Row - 1
    Dim colWeek As Integer: colWeek = 0
    Dim colOp As Integer: colOp = 0
    Dim colDiff As Integer: colDiff = 0

    Dim col As Integer
    For col = 1 To 20
        Dim h As String: h = LCase(wsDados.Cells(headerRow, col).Value)
        If h = "week" Then colWeek = col
        If h = "operator_name" Then colOp = col
        If h = "diff" Or h = "diferenca" Or h = "cash_diff" Then colDiff = col
    Next col

    Dim rowNum As Long
    Dim bg As Boolean: bg = True
    For rowNum = rng.Row To Application.Min(rng.Row + 7, rng.Row + rng.Rows.Count - 1)
        If colWeek > 0 Then ws.Cells(r, c).Value = wsDados.Cells(rowNum, colWeek).Value
        If colOp > 0 Then ws.Cells(r, c + 1).Value = wsDados.Cells(rowNum, colOp).Value
        If colDiff > 0 Then
            Dim diff As Variant
            diff = wsDados.Cells(rowNum, colDiff).Value
            ws.Cells(r, c + 2).Value = IIf(IsNumeric(diff), "R$ " & Format(CDbl(diff), "#,##0.00"), diff)
            If IsNumeric(diff) And CDbl(diff) < 0 Then
                ws.Cells(r, c + 2).Font.Color = CLR_RED
            End If
        End If
        For i = 0 To 2
            ws.Cells(r, c + i).Font.Size = 8
        Next i
        If bg Then ws.Range(ws.Cells(r, c), ws.Cells(r, c + 2)).Interior.Color = CLR_LIGHT
        bg = Not bg
        r = r + 1
    Next rowNum
End Sub
