Attribute VB_Name = "mdl_Presidencia"
'=============================================================================
' Aba: PRESIDENCIA — Pulso da Associação
' Pergunta diretriz: "Como está a saúde geral da associação esta semana?"
'
' Gauge "Pulso da Associação" (0-100):
'   Componente              Peso   Fonte
'   ─────────────────────────────────────
'   Taxa de cobrança        30%    collection_rate.pct_paid
'   Adimplência acumulada   20%    delinquency_report
'   Crescimento moradores   10%    member_growth_weekly
'   SLA pacotes             15%    sla_by_type
'   Performance operadores  15%    operator_performance
'   Tarefas concluídas      10%    tasks_by_collaborator
'=============================================================================
Option Explicit

Private Const CLR_NAVY     As Long = 2298644   ' #141323 RGB(20,19,35)
Private Const CLR_CERULEAN As Long = 11702536  ' RGB(8,145,178)
Private Const CLR_AMBER    As Long = 761589    ' RGB(245,158,11)
Private Const CLR_WHITE    As Long = 16777215
Private Const CLR_LIGHT    As Long = 16184563  ' RGB(243,244,246)
Private Const CLR_GREEN    As Long = 4891414   ' RGB(22,163,74)
Private Const CLR_RED      As Long = 2498780   ' RGB(220,38,38)

Public Sub PopulatePresidencia()
    Dim ws     As Worksheet
    Dim wsDados As Worksheet

    On Error GoTo ErrHandler

    Set ws = ThisWorkbook.Sheets("PRESIDENCIA")
    Set wsDados = ThisWorkbook.Sheets("_DADOS")

    Application.ScreenUpdating = False
    ws.Range("B4:M60").ClearContents

    ' Pergunta diretriz
    With ws.Range("B4")
        .Value = ChrW(8220) & "Como está a saúde geral da associação esta semana?" & ChrW(8221)
        .Font.Italic = True
        .Font.Color = CLR_CERULEAN
        .Font.Size = 10
    End With

    ' ── Calcula componentes do Pulso ─────────────────────────────────────────
    Dim scoreCobranca    As Double
    Dim scoreAdimpl      As Double
    Dim scoreCrescimento As Double
    Dim scoreSLA         As Double
    Dim scoreOp          As Double
    Dim scoreTarefas     As Double

    ' 1. Taxa cobrança — calculada dos totais combinados (ambas associações)
    Dim pagasT As Variant: pagasT = mdl_Inicio.GetScalar(wsDados, "INADIMPL_TOTAL", "pagas",    "", "")
    Dim pendT  As Variant: pendT  = mdl_Inicio.GetScalar(wsDados, "INADIMPL_TOTAL", "pendentes","", "")
    Dim pct As Variant
    Dim totCob As Double: totCob = mdl_Inicio.SafeD(pagasT) + mdl_Inicio.SafeD(pendT)
    If totCob > 0 Then pct = Round(mdl_Inicio.SafeD(pagasT) / totCob * 100, 1)
    scoreCobranca = NormalizeScore(pct, 0, 100) * 0.3

    ' 2. Adimplência acumulada: pagas / (pagas + vencidas + pendentes) — dados combinados
    Dim pagas As Variant, vencidas As Variant, pendentes As Variant
    pagas    = mdl_Inicio.GetScalar(wsDados, "INADIMPL_TOTAL", "pagas",    "", "")
    vencidas = mdl_Inicio.GetScalar(wsDados, "INADIMPL_TOTAL", "vencidas", "", "")
    pendentes = mdl_Inicio.GetScalar(wsDados, "INADIMPL_TOTAL","pendentes","", "")
    Dim total As Double
    total = SafeD(pagas) + SafeD(vencidas) + SafeD(pendentes)
    Dim adimplRate As Double
    adimplRate = IIf(total > 0, SafeD(pagas) / total * 100, 50)
    scoreAdimpl = NormalizeScore(adimplRate, 0, 100) * 0.2

    ' 3. Crescimento de moradores (crescimento positivo = 100, queda = 0)
    Dim crescimento As Variant
    crescimento = mdl_Inicio.GetScalar(wsDados, "CRESCIMENTO", "net_new", "", "")
    scoreCrescimento = IIf(SafeD(crescimento) >= 0, 100, 0) * 0.1

    ' 4. SLA pacotes (% entregues dentro do SLA)
    Dim sla As Variant
    sla = mdl_Inicio.GetScalar(wsDados, "SLA_TIPO", "pct_on_time", "", "")
    scoreSLA = NormalizeScore(sla, 0, 100) * 0.15

    ' 5. Performance operadores (enc_recv = encaminhamentos por recebimento)
    Dim encRecv As Variant
    encRecv = mdl_Inicio.GetScalar(wsDados, "OP_PERFORMANCE", "enc_recv_pct", "", "")
    scoreOp = NormalizeScore(encRecv, 0, 100) * 0.15

    ' 6. Tarefas concluídas (% concluídas na semana)
    Dim concluidas As Variant
    Dim totalTarefas As Variant
    concluidas = mdl_Inicio.GetScalar(wsDados, "RANK_COLAB", "concluidas", "", "")
    totalTarefas = mdl_Inicio.GetScalar(wsDados, "KPI_OP", "tarefas_semana", "", "")
    Dim pctTarefas As Double
    pctTarefas = IIf(SafeD(totalTarefas) > 0, SafeD(concluidas) / SafeD(totalTarefas) * 100, 50)
    scoreTarefas = NormalizeScore(pctTarefas, 0, 100) * 0.1

    ' Score composto (0–100)
    Dim pulso As Long
    pulso = CLng(scoreCobranca + scoreAdimpl + scoreCrescimento + scoreSLA + scoreOp + scoreTarefas)
    If pulso > 100 Then pulso = 100
    If pulso < 0 Then pulso = 0

    ' ── Escreve gauge (shape text + KPIs) ──────────────────────────────────
    WriteGauge ws, pulso
    WritePresidenciaKPIs ws, wsDados, scoreCobranca, scoreAdimpl, scoreCrescimento, scoreSLA, scoreOp, scoreTarefas, pct, adimplRate, crescimento, sla, encRecv, pctTarefas

    Application.ScreenUpdating = True
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    MsgBox "Erro em PopulatePresidencia: " & Err.Description, vbCritical
End Sub


Private Sub WriteGauge(ws As Worksheet, score As Long)
    ' Escreve o score em célula central — o gauge visual está no design da aba
    ' e usa uma shape vinculada ao named range PULSO_SCORE
    Dim scoreRange As Range
    On Error Resume Next
    Set scoreRange = ws.Range("PULSO_SCORE")
    On Error GoTo 0

    If Not scoreRange Is Nothing Then
        scoreRange.Value = score
        scoreRange.Font.Size = 28
        scoreRange.Font.Bold = True
        scoreRange.HorizontalAlignment = xlCenter

        Select Case score
            Case 0 To 29:  scoreRange.Font.Color = CLR_RED
            Case 30 To 59: scoreRange.Font.Color = CLR_AMBER
            Case 60 To 79: scoreRange.Font.Color = RGB(134, 197, 80)
            Case Else:     scoreRange.Font.Color = CLR_GREEN
        End Select
    End If

    ' Label do score
    Dim labelRange As Range
    On Error Resume Next
    Set labelRange = ws.Range("PULSO_LABEL")
    On Error GoTo 0
    If Not labelRange Is Nothing Then
        Select Case score
            Case 0 To 29:  labelRange.Value = "CRÍTICO"
            Case 30 To 59: labelRange.Value = "ATENÇÃO"
            Case 60 To 79: labelRange.Value = "BOM"
            Case Else:     labelRange.Value = "EXCELENTE"
        End Select
    End If
End Sub


Private Sub WritePresidenciaKPIs(ws As Worksheet, wsDados As Worksheet, _
    sc1 As Double, sc2 As Double, sc3 As Double, sc4 As Double, sc5 As Double, sc6 As Double, _
    pct As Variant, adimpl As Double, cresc As Variant, sla As Variant, encRecv As Variant, tarefas As Double)

    Dim startRow As Long: startRow = 14
    Dim col As Long:      col = 2

    ' Cabeçalho da tabela de componentes
    WriteKpiTableHeader ws, startRow, col

    startRow = startRow + 1
    WriteKpiTableRow ws, startRow,     col, "Taxa de Cobrança",       sc1 / 0.3, IIf(IsEmpty(pct), "–", Format(CDbl(pct), "0.0") & "%"),        sc1 * 100 / 30
    WriteKpiTableRow ws, startRow + 1, col, "Adimplência Acumulada",  sc2 / 0.2, Format(adimpl, "0.0") & "%",                                    sc2 * 100 / 20
    WriteKpiTableRow ws, startRow + 2, col, "Crescimento Moradores",  sc3 / 0.1, IIf(IsEmpty(cresc), "–", CStr(cresc) & " esta semana"),          sc3 * 100 / 10
    WriteKpiTableRow ws, startRow + 3, col, "SLA Pacotes",            sc4 / 0.15, IIf(IsEmpty(sla), "–", Format(CDbl(sla), "0.0") & "%"),        sc4 * 100 / 15
    WriteKpiTableRow ws, startRow + 4, col, "Performance Operadores", sc5 / 0.15, IIf(IsEmpty(encRecv), "–", Format(CDbl(encRecv), "0.0") & "%"), sc5 * 100 / 15
    WriteKpiTableRow ws, startRow + 5, col, "Tarefas Concluídas",     sc6 / 0.1, Format(tarefas, "0.0") & "%",                                    sc6 * 100 / 10

    ' Linha de tendência: morador mais ativo
    Dim startRow2 As Long
    startRow2 = startRow + 8
    With ws.Cells(startRow2, col)
        .Value = "OPERADOR COM MAIS ATIVIDADE NA SEMANA"
        .Font.Bold = True
        .Font.Size = 9
        .Font.Color = CLR_WHITE
        .Interior.Color = CLR_NAVY
    End With

    Dim topOp As Variant
    topOp = mdl_Inicio.GetScalar(wsDados, "OP_PERFORMANCE", "operator_name", "", "")
    ws.Cells(startRow2 + 1, col).Value = IIf(IsEmpty(topOp), "–", CStr(topOp))
    ws.Cells(startRow2 + 1, col).Font.Bold = True
    ws.Cells(startRow2 + 1, col).Font.Color = CLR_CERULEAN
End Sub


Private Sub WriteKpiTableHeader(ws As Worksheet, r As Long, c As Long)
    Dim headers As Variant
    headers = Array("Componente", "Score bruto", "Valor atual", "Contribuição %")
    Dim i As Integer
    For i = 0 To 3
        With ws.Cells(r, c + i)
            .Value = headers(i)
            .Font.Bold = True
            .Font.Color = CLR_WHITE
            .Interior.Color = CLR_CERULEAN
            .Font.Size = 8
        End With
    Next i
End Sub


Private Sub WriteKpiTableRow(ws As Worksheet, r As Long, c As Long, _
    label As String, scoreRaw As Double, valor As String, contrib As Double)

    ws.Cells(r, c).Value = label
    ws.Cells(r, c).Font.Size = 8

    ws.Cells(r, c + 1).Value = Format(scoreRaw, "0.0")
    ws.Cells(r, c + 1).HorizontalAlignment = xlRight

    ws.Cells(r, c + 2).Value = valor

    ws.Cells(r, c + 3).Value = Format(contrib, "0.0") & "%"
    ws.Cells(r, c + 3).HorizontalAlignment = xlRight

    ' Cor de fundo alternada
    If r Mod 2 = 0 Then
        ws.Range(ws.Cells(r, c), ws.Cells(r, c + 3)).Interior.Color = CLR_LIGHT
    End If

    ' Mini barra de contribuição (barra de fundo via cell pattern — simplificado)
    With ws.Cells(r, c + 3)
        If contrib >= 80 Then
            .Font.Color = CLR_GREEN
        ElseIf contrib >= 50 Then
            .Font.Color = CLR_AMBER
        Else
            .Font.Color = CLR_RED
        End If
    End With
End Sub


' ── Helpers ─────────────────────────────────────────────────────────────────
Private Function NormalizeScore(val As Variant, minVal As Double, maxVal As Double) As Double
    If IsEmpty(val) Or IsNull(val) Or Not IsNumeric(val) Then
        NormalizeScore = 50  ' neutro quando sem dados
        Exit Function
    End If
    Dim v As Double: v = CDbl(val)
    If v <= minVal Then NormalizeScore = 0: Exit Function
    If v >= maxVal Then NormalizeScore = 100: Exit Function
    NormalizeScore = (v - minVal) / (maxVal - minVal) * 100
End Function

Private Function SafeD(val As Variant) As Double
    If IsEmpty(val) Or IsNull(val) Or Not IsNumeric(val) Then
        SafeD = 0
    Else
        SafeD = CDbl(val)
    End If
End Function
