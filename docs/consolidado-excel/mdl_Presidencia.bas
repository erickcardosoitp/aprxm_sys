Attribute VB_Name = "mdl_Presidencia"
'=============================================================================
' Aba: PRESIDENCIA — 9 KPI Cards com Sparklines
' Layout: 3 colunas × 3 linhas, colunas A-T, zoom 150%
'
' Cards (esquerda?direita, cima?baixo):
'   1. Receita Líquida     2. Taxa de Cobrança    3. Inadimplência
'   4. Crescimento          5. Retenção Pagantes   6. Encomendas
'   7. Tempo de Entrega     8. Tarefas no Prazo    9. Score Operadores
'=============================================================================
Option Explicit

' -- Colors (consistent with mdl_Inicio) -------------------------------------
Private Const CLR_BG       As Long = 2298644    ' RGB(20, 19, 35) navy dark
Private Const CLR_CARD     As Long = 3286830    ' RGB(46, 51, 50) card bg
Private Const CLR_ACCENT   As Long = 11702536   ' RGB(8, 145, 178) cerulean
Private Const CLR_WHITE    As Long = 16777215
Private Const CLR_GREEN    As Long = 4891414    ' RGB(22, 163, 74)
Private Const CLR_RED      As Long = 2498780    ' RGB(220, 38, 38)
Private Const CLR_AMBER    As Long = 761589     ' RGB(245, 158, 11)
Private Const CLR_MUTED    As Long = 8684928    ' RGB(128, 140, 132) muted gray

' -- Layout --------------------------------------------------------------------
Private Const WS_PRES      As String = "PRESIDENCIA"
Private Const TITLE_ROW    As Long = 1
Private Const SUBTTL_ROW   As Long = 2
Private Const FILTER_ROW   As Long = 3
Private Const SPACER_ROW   As Long = 4
Private Const CARDS_START  As Long = 5
Private Const CARD_H       As Long = 13   ' rows per card
Private Const CARD_GAP     As Long = 1    ' gap rows between card tiers
Private Const CARD_W       As Integer = 6
Private Const COL_C1       As Integer = 2   ' col B — card left positions
Private Const COL_C2       As Integer = 9   ' col I
Private Const COL_C3       As Integer = 16  ' col P

Private Const ASSOC_VL     As String = "fc5e1eaf-ac28-4fda-9c10-2c9184cf7297"
Private Const ASSOC_CG     As String = "f9a29c3f-0b35-467d-82f4-4ac3b79a51b2"

' Filter state (independent from mdl_Inicio)
Public  m_PresAssocId As String   ' "" = all, or specific UUID
Private m_PresInit    As Boolean


'=============================================================================
' ENTRY POINTS
'=============================================================================
Public Sub PopulatePresidencia()
    Dim ws     As Worksheet
    Dim wsDados As Worksheet
    On Error GoTo ErrHandler

    Set ws = ThisWorkbook.Sheets(WS_PRES)
    Set wsDados = ThisWorkbook.Sheets("_DADOS")

    Application.ScreenUpdating = False
    Application.Calculation    = xlCalculationManual

    ' Full clear
    ClearPresidencia ws

    ' Background + column/row setup
    SetupBackground ws

    ' Static elements
    SetupHeader ws
    SetupFilterShapes ws

    ' All 9 KPI cards with data
    DrawAllCards ws, wsDados

    m_PresInit = True
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrHandler:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    MsgBox "Erro PopulatePresidencia: " & Err.Description, vbCritical
End Sub


Public Sub RefreshPresidencia()
    If Not m_PresInit Then Call PopulatePresidencia: Exit Sub
    Dim ws As Worksheet, wsDados As Worksheet
    Set ws = ThisWorkbook.Sheets(WS_PRES)
    Set wsDados = ThisWorkbook.Sheets("_DADOS")
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    UpdateFilterStyles ws
    DrawAllCards ws, wsDados
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
End Sub


' Filter button handlers
Public Sub Pres_All(): m_PresAssocId = "":       Call RefreshPresidencia: End Sub
Public Sub Pres_VL():  m_PresAssocId = ASSOC_VL: Call RefreshPresidencia: End Sub
Public Sub Pres_CG():  m_PresAssocId = ASSOC_CG: Call RefreshPresidencia: End Sub


'=============================================================================
' SETUP — layout, background, header, filters
'=============================================================================
Private Sub ClearPresidencia(ws As Worksheet)
    ' Deletar gráficos sem iterar com For Each (causa "subscript out of range")
    Do While ws.ChartObjects.Count > 0
        ws.ChartObjects(1).Delete
    Loop

    ' Coletar nomes das shapes FPA_ primeiro, depois deletar
    Dim sh As Shape, i As Integer, n As Integer: n = 0
    Dim toDelete(100) As String
    For Each sh In ws.Shapes
        If Left(sh.Name, 4) = "FPA_" Then
            toDelete(n) = sh.Name: n = n + 1
        End If
    Next sh
    For i = 0 To n - 1
        On Error Resume Next: ws.Shapes(toDelete(i)).Delete: On Error GoTo 0
    Next i

    ws.Cells.ClearContents
    ws.Cells.ClearFormats
    ws.Cells.Interior.Color = CLR_BG
End Sub


Private Sub SetupBackground(ws As Worksheet)
    ws.Tab.Color = CLR_BG
    On Error Resume Next: ws.Application.ActiveWindow.DisplayGridlines = False: On Error GoTo 0

    ' Margin columns (narrow)
    ws.Columns(1).ColumnWidth = 1   ' col A left margin
    ws.Columns(8).ColumnWidth = 1   ' col H gap between card 1-2
    ws.Columns(15).ColumnWidth = 1  ' col O gap between card 2-3

    ' Card columns: B-G (2-7), I-N (9-14), P-U (16-21) — using P-T (16-20)
    Dim c As Integer
    For c = 2 To 7:  ws.Columns(c).ColumnWidth = 10: Next c   ' card 1
    For c = 9 To 14: ws.Columns(c).ColumnWidth = 10: Next c   ' card 2
    For c = 16 To 20: ws.Columns(c).ColumnWidth = 10: Next c  ' card 3

    ' Row heights
    ws.Rows(TITLE_ROW).RowHeight  = 26
    ws.Rows(SUBTTL_ROW).RowHeight = 14
    ws.Rows(FILTER_ROW).RowHeight = 28
    ws.Rows(SPACER_ROW).RowHeight = 6

    ' Card tiers row heights
    Dim tier As Integer, r As Long
    For tier = 0 To 2
        r = CARDS_START + tier * (CARD_H + CARD_GAP)
        ws.Rows(r).RowHeight      = 14   ' r+0  title label
        ws.Rows(r + 1).RowHeight  = 6    ' r+1  spacer
        ws.Rows(r + 2).RowHeight  = 30   ' r+2  big number
        ws.Rows(r + 3).RowHeight  = 13   ' r+3  unit/subtitle
        ws.Rows(r + 4).RowHeight  = 6    ' r+4  separator
        ws.Rows(r + 5).RowHeight  = 12   ' r+5  sparkline row 1
        ws.Rows(r + 6).RowHeight  = 12   ' r+6  sparkline row 2
        ws.Rows(r + 7).RowHeight  = 12   ' r+7  sparkline row 3
        ws.Rows(r + 8).RowHeight  = 12   ' r+8  sparkline row 4
        ws.Rows(r + 9).RowHeight  = 16   ' r+9  badge row 1 (W/S M/M)
        ws.Rows(r + 10).RowHeight = 18   ' r+10 delta row
        ws.Rows(r + 11).RowHeight = 4    ' r+11 bottom margin
        ws.Rows(r + 12).RowHeight = 8    ' r+12 gap to next tier
    Next tier

    ' Background for all used area
    ws.Range("A1:T60").Interior.Color = CLR_BG
End Sub


Private Sub SetupHeader(ws As Worksheet)
    ' Title
    With ws.Range(ws.Cells(TITLE_ROW, 2), ws.Cells(TITLE_ROW, 20))
        .Merge
        .Value = "PRESIDÊNCIA  " & ChrW(8212) & "  INDICADORES EXECUTIVOS"
        .Font.Name = "Calibri"
        .Font.Size = 13
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .HorizontalAlignment = xlLeft
        .Interior.Color = CLR_BG
    End With

    ' Subtitle
    With ws.Range(ws.Cells(SUBTTL_ROW, 2), ws.Cells(SUBTTL_ROW, 20))
        .Merge
        .Value = "Atualizado em " & Format(Now, "dd/mm/yyyy") & _
                 "  " & ChrW(183) & "  Instituto Tia Pretinha  " & _
                 ChrW(183) & "  Últimos 6 meses"
        .Font.Name = "Calibri"
        .Font.Size = 8
        .Font.Color = CLR_MUTED
        .HorizontalAlignment = xlLeft
        .Interior.Color = CLR_BG
    End With
End Sub


Private Sub SetupFilterShapes(ws As Worksheet)
    Dim btnH   As Single: btnH   = ws.Rows(FILTER_ROW).Height - 6
    Dim btnTop As Single: btnTop = ws.Rows(FILTER_ROW).Top + 3
    Dim btnW   As Single: btnW   = 80
    Dim gap    As Single: gap    = 6
    Dim leftX  As Single: leftX  = ws.Columns(COL_C1).Left

    ' Label "ASSOCIAÇÃO"
    With ws.Cells(FILTER_ROW, 2)
        .Value = "FILTRO:"
        .Font.Name = "Calibri"
        .Font.Size = 7
        .Font.Bold = True
        .Font.Color = CLR_MUTED
        .HorizontalAlignment = xlLeft
        .VerticalAlignment = xlCenter
        .Interior.Color = CLR_BG
    End With

    Dim labels(2) As String, macros(2) As String, ids(2) As String
    labels(0) = "TODAS":    macros(0) = "mdl_Presidencia.Pres_All": ids(0) = "FPA_ALL"
    labels(1) = "VAZ LOBO": macros(1) = "mdl_Presidencia.Pres_VL":  ids(1) = "FPA_VL"
    labels(2) = "CONGONHA": macros(2) = "mdl_Presidencia.Pres_CG":  ids(2) = "FPA_CG"

    Dim i As Integer
    Dim offsetX As Single: offsetX = ws.Columns(COL_C1).Width + gap  ' leave col B for label

    For i = 0 To 2
        Dim shp As Shape
        Set shp = ws.Shapes.AddShape(msoShapeRoundedRectangle, _
                  leftX + offsetX + i * (btnW + gap), btnTop, btnW, btnH)
        shp.Name = ids(i)
        shp.OnAction = macros(i)
        shp.TextFrame.Characters.Text = labels(i)
        shp.TextFrame.Characters.Font.Size = 8
        shp.TextFrame.Characters.Font.Bold = True
        shp.TextFrame.Characters.Font.Color = CLR_WHITE
        shp.TextFrame.HorizontalAlignment = xlHAlignCenter
        shp.TextFrame.VerticalAlignment = xlVAlignCenter
        shp.Line.Weight = 0.75

        Dim isActive As Boolean
        If i = 0 Then isActive = (m_PresAssocId = "")
        If i = 1 Then isActive = (m_PresAssocId = ASSOC_VL)
        If i = 2 Then isActive = (m_PresAssocId = ASSOC_CG)
        ApplyBtnStyle shp, isActive
    Next i
End Sub


Private Sub UpdateFilterStyles(ws As Worksheet)
    Dim ids(2) As String
    ids(0) = "FPA_ALL": ids(1) = "FPA_VL": ids(2) = "FPA_CG"
    Dim i As Integer
    For i = 0 To 2
        Dim shp As Shape
        On Error Resume Next: Set shp = ws.Shapes(ids(i)): On Error GoTo 0
        If Not shp Is Nothing Then
            Dim isActive As Boolean
            If i = 0 Then isActive = (m_PresAssocId = "")
            If i = 1 Then isActive = (m_PresAssocId = ASSOC_VL)
            If i = 2 Then isActive = (m_PresAssocId = ASSOC_CG)
            ApplyBtnStyle shp, isActive
        End If
    Next i
End Sub


Private Sub ApplyBtnStyle(shp As Shape, isActive As Boolean)
    If isActive Then
        shp.Fill.ForeColor.RGB = CLR_ACCENT
        shp.Line.ForeColor.RGB = CLR_ACCENT
    Else
        shp.Fill.ForeColor.RGB = RGB(38, 48, 58)
        shp.Line.ForeColor.RGB = RGB(60, 78, 95)
    End If
End Sub


'=============================================================================
' CARD DRAWING
'=============================================================================
Private Sub DrawAllCards(ws As Worksheet, wsDados As Worksheet)
    Dim cardCols(2) As Integer
    cardCols(0) = COL_C1: cardCols(1) = COL_C2: cardCols(2) = COL_C3

    Dim i As Integer
    For i = 0 To 8
        Dim tier    As Integer: tier    = i \ 3
        Dim cardCol As Integer: cardCol = i Mod 3
        Dim topRow  As Long
        topRow = CARDS_START + tier * (CARD_H + CARD_GAP)
        DrawCard ws, wsDados, i, topRow, cardCols(cardCol)
    Next i
End Sub


Private Sub DrawCard(ws As Worksheet, wsDados As Worksheet, _
                     cardIdx As Integer, topRow As Long, leftCol As Integer)
    ' -- Card metadata ----------------------------------------------------------
    Dim cardTitle As String, rangeKey As String, colName As String
    Dim unitStr As String, fmtCode As String, invertDelta As Boolean
    Dim useAvg As Boolean

    Select Case cardIdx
        Case 0
            cardTitle = "RECEITA LÍQUIDA":    rangeKey = "MARGEM_MES":    colName = "net"
            unitStr = "R$":                    fmtCode = "currency":       invertDelta = False: useAvg = False
        Case 1
            cardTitle = "TAXA DE COBRANÇA":   rangeKey = "TAXA_COBRANCA": colName = "pct_paid"
            unitStr = "% pagas":               fmtCode = "pct":            invertDelta = False: useAvg = True
        Case 2
            cardTitle = "INADIMPLÊNCIA":       rangeKey = "TAXA_COBRANCA": colName = "pct_pendente"
            unitStr = "% pendentes":           fmtCode = "pct":            invertDelta = True:  useAvg = True
        Case 3
            cardTitle = "CRESCIMENTO":         rangeKey = "MORADORES_MES": colName = "members"
            unitStr = "novos/m" & ChrW(234) & "s":     fmtCode = "integer":        invertDelta = False: useAvg = False
        Case 4
            cardTitle = "RETENÇÃO PAGANTES":   rangeKey = "RETENCAO_MES":  colName = "taxa_retencao"
            unitStr = "% retidos":             fmtCode = "pct":            invertDelta = False: useAvg = True
        Case 5
            cardTitle = "ENCOMENDAS":          rangeKey = "PACOTES_MES":   colName = "recebidos"
            unitStr = "recebidas":             fmtCode = "integer":        invertDelta = False: useAvg = False
        Case 6
            cardTitle = "TEMPO DE ENTREGA":    rangeKey = "PACOTES_MES":   colName = "avg_dwell_dias"
            unitStr = "dias médios":           fmtCode = "decimal1":       invertDelta = True:  useAvg = True
        Case 7
            cardTitle = "TAREFAS NO PRAZO":    rangeKey = "TASKS_MES":     colName = "pct_on_time"
            unitStr = "% no prazo":            fmtCode = "pct":            invertDelta = False: useAvg = True
        Case 8
            cardTitle = "SCORE OPERADORES":    rangeKey = "OP_SCORE_MES":  colName = "score"
            unitStr = "pts / 100":             fmtCode = "decimal1":       invertDelta = False: useAvg = True
    End Select

    ' -- Get series data (ASC, up to 13 months) -------------------------------
    Dim series As Variant
    series = GetMonthlySeries(wsDados, rangeKey, colName, m_PresAssocId, 13, useAvg)

    Dim nPts As Integer: nPts = 0
    If IsArray(series) Then
        On Error Resume Next: nPts = UBound(series) - LBound(series) + 1: On Error GoTo 0
    End If

    Dim currVal  As Double: currVal  = 0
    Dim prev1Val As Double: prev1Val = 0
    Dim prev3Val As Double: prev3Val = 0
    Dim prev12Val As Double: prev12Val = 0

    If nPts > 0  Then currVal   = series(nPts - 1)
    If nPts > 1  Then prev1Val  = series(nPts - 2)
    If nPts > 3  Then prev3Val  = series(nPts - 4)
    If nPts > 12 Then prev12Val = series(0)

    ' CRESCIMENTO: big number = novos no mes (delta mes anterior)
    If cardIdx = 3 And nPts > 1 Then
        currVal   = series(nPts - 1) - series(nPts - 2)
        If nPts > 2 Then prev1Val  = series(nPts - 2) - series(nPts - 3) Else prev1Val = 0
        If nPts > 4 Then prev3Val  = series(nPts - 4) - series(nPts - 5) Else prev3Val = 0
        prev12Val = 0
    End If

    ' -- Card background --------------------------------------------------------
    ws.Range(ws.Cells(topRow, leftCol), ws.Cells(topRow + CARD_H - 2, leftCol + CARD_W - 1)) _
        .Interior.Color = CLR_CARD

    ' -- Title label -----------------------------------------------------------
    With ws.Cells(topRow, leftCol)
        .Value = cardTitle
        .Font.Name = "Calibri"
        .Font.Size = 8
        .Font.Bold = True
        .Font.Color = CLR_MUTED
        .HorizontalAlignment = xlLeft
        .VerticalAlignment = xlCenter
        .Interior.Color = CLR_CARD
    End With

    ' -- Big number ------------------------------------------------------------
    With ws.Range(ws.Cells(topRow + 2, leftCol), ws.Cells(topRow + 2, leftCol + CARD_W - 1))
        .Merge
        .Value = FormatKpi(currVal, fmtCode)
        .Font.Name = "Calibri"
        .Font.Size = 23
        .Font.Bold = True
        .Font.Color = CLR_WHITE
        .HorizontalAlignment = xlLeft
        .VerticalAlignment = xlCenter
        .Interior.Color = CLR_CARD
    End With

    ' -- Unit / subtitle -------------------------------------------------------
    With ws.Range(ws.Cells(topRow + 3, leftCol), ws.Cells(topRow + 3, leftCol + CARD_W - 1))
        .Merge
        .Value = unitStr
        .Font.Name = "Calibri"
        .Font.Size = 8
        .Font.Color = CLR_MUTED
        .HorizontalAlignment = xlLeft
        .Interior.Color = CLR_CARD
    End With

    ' -- Sparkline -------------------------------------------------------------
    If nPts >= 2 Then
        ' Extract last 6 points for sparkline
        Dim spkStart As Integer: spkStart = IIf(nPts > 6, nPts - 6, 0)
        Dim spkLen   As Integer: spkLen   = nPts - spkStart
        Dim spkData() As Double
        ReDim spkData(spkLen - 1)
        Dim k As Integer
        For k = 0 To spkLen - 1
            spkData(k) = series(spkStart + k)
        Next k
        DrawSparkline ws, spkData, topRow + 5, leftCol, 4, CARD_W, fmtCode
    End If

    ' -- WoW via DL_CRESCIMENTO (card 3); outros cards: n/d -----------------
    Dim wowCurr As Double: wowCurr = 0
    Dim wowPrev As Double: wowPrev = 0
    If cardIdx = 3 Then
        Dim wSeries As Variant
        wSeries = GetWeeklySeries(wsDados, "CRESCIMENTO", "novos_associados", m_PresAssocId, 3)
        Dim wnPts As Integer: wnPts = 0
        If IsArray(wSeries) Then
            On Error Resume Next: wnPts = UBound(wSeries) - LBound(wSeries) + 1: On Error GoTo 0
        End If
        If wnPts > 0 Then wowCurr = wSeries(wnPts - 1)
        If wnPts > 1 Then wowPrev = wSeries(wnPts - 2)
    End If

    ' -- Delta badges (r+9: W/S+M/M  |  r+10: T/T+A/A) ----------------------
    Dim deltaRow As Long: deltaRow = topRow + 10
    Dim wowStr As String, wowClr As Long
    Dim momStr As String, momClr As Long
    Dim qoqStr As String, qoqClr As Long
    Dim yoyStr As String, yoyClr As Long

    wowStr = CalcDelta(wowCurr, wowPrev, invertDelta, wowClr)
    momStr = CalcDelta(currVal, prev1Val,  invertDelta, momClr)
    qoqStr = CalcDelta(currVal, prev3Val,  invertDelta, qoqClr)
    yoyStr = CalcDelta(currVal, prev12Val, invertDelta, yoyClr)

    Dim wowCtx As String, momCtx As String, qoqCtx As String, yoyCtx As String
    If wowPrev = 0 Then
        wowCtx = "n/d"
    Else
        wowCtx = "(Sem. Ant.: " & FormatKpiShort(wowPrev, fmtCode) & " | Sem. Atual: " & FormatKpiShort(wowCurr, fmtCode) & ")"
    End If
    If prev1Val = 0 Then
        momCtx = "n/d"
    Else
        momCtx = "(Mês Ant.: " & FormatKpiShort(prev1Val, fmtCode) & " | Mês Atual: " & FormatKpiShort(currVal, fmtCode) & ")"
    End If
    If prev3Val = 0 Then
        qoqCtx = "n/d"
    Else
        qoqCtx = "(Trim. Ant.: " & FormatKpiShort(prev3Val, fmtCode) & " | Trim. Atual: " & FormatKpiShort(currVal, fmtCode) & ")"
    End If
    If prev12Val = 0 Then
        yoyCtx = "n/d"
    Else
        yoyCtx = "(Ano Ant.: " & FormatKpiShort(prev12Val, fmtCode) & " | Ano Atual: " & FormatKpiShort(currVal, fmtCode) & ")"
    End If

    WriteDeltaBadge ws, topRow + 9, leftCol,     "WoW", wowStr, wowClr, wowCtx
    WriteDeltaBadge ws, topRow + 9, leftCol + 3, "MoM", momStr, momClr, momCtx
    WriteDeltaBadge ws, deltaRow,   leftCol,     "ToT", qoqStr, qoqClr, qoqCtx
    WriteDeltaBadge ws, deltaRow,   leftCol + 3, "YoY", yoyStr, yoyClr, yoyCtx
End Sub


'=============================================================================
' SPARKLINE CHART
'=============================================================================
Private Sub DrawSparkline(ws As Worksheet, dataArr() As Double, _
                           topRow As Long, leftCol As Integer, _
                           numRows As Long, numCols As Integer, _
                           fmtCode As String)
    Dim nPts As Integer: nPts = UBound(dataArr) - LBound(dataArr) + 1
    If nPts < 2 Then Exit Sub

    Dim chartName As String: chartName = "SPK_" & topRow & "_" & leftCol

    ' Compute position
    Dim L As Single: L = ws.Cells(topRow, leftCol).Left + 1
    Dim T As Single: T = ws.Cells(topRow, 1).Top + 1
    Dim W As Single: W = ws.Range(ws.Cells(topRow, leftCol), _
                                   ws.Cells(topRow, leftCol + numCols - 1)).Width - 2
    Dim H As Single: H = ws.Range(ws.Cells(topRow, 1), _
                                   ws.Cells(topRow + numRows - 1, 1)).Height - 2

    ' Try to reuse existing chart
    Dim co  As ChartObject
    Dim cht As Chart
    Dim srs As Series

    On Error Resume Next: Set co = ws.ChartObjects(chartName): On Error GoTo 0

    If co Is Nothing Then
        ' Create new
        Set co  = ws.ChartObjects.Add(L, T, W, H)
        co.Name = chartName

        Set cht = co.Chart
        cht.ChartType = xlLine
        Set srs = cht.SeriesCollection.NewSeries()
        srs.Values = dataArr

        ' No decoration
        cht.HasTitle  = False
        cht.HasLegend = False
        co.Border.LineStyle       = xlNone
        cht.ChartArea.Border.LineStyle   = xlNone
        cht.ChartArea.Interior.Color     = CLR_CARD
        cht.PlotArea.Border.LineStyle    = xlNone
        cht.PlotArea.Interior.Color      = CLR_CARD

        ' Hide axes
        On Error Resume Next
        cht.Axes(xlValue).Delete
        cht.Axes(xlCategory).Delete
        On Error GoTo 0

        ' Series line style
        On Error Resume Next
        With srs.Format.Line
            .ForeColor.RGB = CLR_ACCENT
            .Weight = 1.5
        End With
        srs.MarkerStyle = xlMarkerStyleNone

        ' Endpoint dot + data label
        With srs.Points(nPts)
            .MarkerStyle             = xlMarkerStyleCircle
            .MarkerSize              = 5
            .MarkerForegroundColor   = CLR_ACCENT
            .MarkerBackgroundColor   = CLR_ACCENT
            .HasDataLabel = True
            With .DataLabel
                .ShowValue = True
                .Font.Name = "Calibri"
                .Font.Size = 5
                .Font.Color = CLR_MUTED
            End With
        End With
        On Error GoTo 0
    Else
        ' Reuse: reposition + update data only
        co.Left = L: co.Top = T: co.Width = W: co.Height = H
        Set cht = co.Chart
        If cht.SeriesCollection.Count > 0 Then
            Set srs = cht.SeriesCollection(1)
            srs.Values = dataArr
            On Error Resume Next
            With srs.Points(nPts)
                .MarkerStyle           = xlMarkerStyleCircle
                .MarkerSize            = 5
                .MarkerForegroundColor = CLR_ACCENT
                .MarkerBackgroundColor = CLR_ACCENT
                .HasDataLabel = True
                With .DataLabel
                    .ShowValue = True
                    .Font.Name = "Calibri"
                    .Font.Size = 5
                    .Font.Color = CLR_MUTED
                End With
            End With
            On Error GoTo 0
        End If
    End If

    ' --- Rótulos: mês + valor em todos os pontos ---
    If Not srs Is Nothing Then
        Dim mAbbr(12) As String
        mAbbr(1) = "jan": mAbbr(2) = "fev": mAbbr(3) = "mar": mAbbr(4) = "abr"
        mAbbr(5) = "mai": mAbbr(6) = "jun": mAbbr(7) = "jul": mAbbr(8) = "ago"
        mAbbr(9) = "set": mAbbr(10) = "out": mAbbr(11) = "nov": mAbbr(12) = "dez"
        Dim spkCats() As String: ReDim spkCats(nPts - 1)
        Dim spi As Integer
        For spi = 0 To nPts - 1
            spkCats(spi) = mAbbr(Month(DateAdd("m", -(nPts - 1 - spi), Date)))
        Next spi
        On Error Resume Next
        srs.XValues = spkCats
        Dim spLbl As Integer
        For spLbl = 1 To nPts
            srs.Points(spLbl).HasDataLabel = True
            srs.Points(spLbl).DataLabel.Text = spkCats(spLbl - 1) & Chr(10) & FormatKpiShort(dataArr(spLbl - 1), fmtCode)
            srs.Points(spLbl).DataLabel.Font.Name = "Calibri"
            srs.Points(spLbl).DataLabel.Font.Size = 5
            srs.Points(spLbl).DataLabel.Font.Color = CLR_MUTED
        Next spLbl
        On Error GoTo 0
    End If
End Sub


'=============================================================================
' DELTA HELPERS
'=============================================================================
Private Function CalcDelta(curr As Double, prev As Double, _
                            invertDelta As Boolean, ByRef outColor As Long) As String
    If prev = 0 Then
        CalcDelta = ChrW(8594) & " n/d"    ' ?
        outColor  = CLR_MUTED
        Exit Function
    End If
    Dim pct As Double: pct = (curr - prev) / Abs(prev) * 100

    ' Positive pct means improvement for normal, worsening for inverted
    Dim isGood As Boolean: isGood = IIf(invertDelta, pct < 0, pct > 0)

    If Abs(pct) < 0.05 Then
        CalcDelta = ChrW(8594) & " 0.0%": outColor = CLR_MUTED
    ElseIf isGood Then
        CalcDelta = ChrW(8593) & " " & Format(Abs(pct), "0.0") & "%"  ' ?
        outColor  = CLR_GREEN
    Else
        CalcDelta = ChrW(8595) & " " & Format(Abs(pct), "0.0") & "%"  ' ?
        outColor  = CLR_RED
    End If
End Function


Private Sub WriteDeltaBadge(ws As Worksheet, r As Long, c As Integer, _
                             label As String, deltaStr As String, clr As Long, _
                             ctxStr As String)
    ' Cel c..c+2 merged: "WoW +15,3%  (Sem. Ant.: 18 | Sem. Atual: 9)"
    Dim fullText As String
    fullText = label & " " & deltaStr

    With ws.Range(ws.Cells(r, c), ws.Cells(r, c + 2))
        On Error Resume Next: .UnMerge: On Error GoTo 0
        .Merge
        .Value = fullText
        .Font.Name = "Calibri"
        .Font.Size = 7
        .Font.Bold = True
        .Font.Color = clr
        .HorizontalAlignment = xlLeft
        .Interior.Color = CLR_CARD
        .WrapText = False
    End With
End Sub


Private Function FormatKpi(val As Double, fmtCode As String) As String
    Select Case fmtCode
        Case "currency"
            If Abs(val) >= 1000 Then
                FormatKpi = "R$ " & Format(val / 1000, "#,##0.0") & "k"
            Else
                FormatKpi = "R$ " & Format(val, "#,##0.0")
            End If
        Case "pct"
            FormatKpi = Format(val, "0.0") & "%"
        Case "integer"
            FormatKpi = Format(val, "#,##0")
        Case "decimal1"
            FormatKpi = Format(val, "0.0")
        Case Else
            FormatKpi = CStr(val)
    End Select
End Function


Private Function FormatKpiShort(val As Double, fmtCode As String) As String
    Select Case fmtCode
        Case "currency"
            If Abs(val) >= 1000 Then
                FormatKpiShort = "R$" & Format(val / 1000, "0.0") & "k"
            Else
                FormatKpiShort = "R$" & Format(val, "#,##0")
            End If
        Case "pct":      FormatKpiShort = Format(val, "0.1") & "%"
        Case "integer":  FormatKpiShort = Format(val, "#,##0")
        Case "decimal1": FormatKpiShort = Format(val, "0.1")
        Case Else:       FormatKpiShort = CStr(val)
    End Select
End Function


Private Function FormatRaw(curr As Double, prev As Double, fmtCode As String) As String
    If prev = 0 Then FormatRaw = "n/d": Exit Function
    FormatRaw = FormatKpiShort(curr, fmtCode) & " / " & FormatKpiShort(prev, fmtCode)
End Function


'=============================================================================
' DATA HELPER — extrai série mensal do _DADOS via named range DL_rangeKey
' Retorna array Double em ordem ASC (mais antigo primeiro)
' assocId = "" ? agrega ambas as associações
' useAvg = True ? divide pelo count (para percentuais)
'=============================================================================

Private Function GetMonthlySeries(wsDados As Worksheet, rangeKey As String, _
                                   colName As String, assocId As String, _
                                   maxMonths As Integer, useAvg As Boolean) As Variant
    GetMonthlySeries = Array()

    Dim rng As Range
    On Error Resume Next: Set rng = wsDados.Range("DL_" & rangeKey): On Error GoTo 0
    If rng Is Nothing Then Exit Function

    Dim hRow As Long: hRow = rng.Row - 1
    Dim colIdx  As Integer: colIdx  = 0
    Dim monthIdx As Integer: monthIdx = 0
    Dim assocIdx As Integer: assocIdx = 0
    Dim c As Integer

    For c = 1 To 30
        Select Case LCase(CStr(wsDados.Cells(hRow, c).Value))
            Case LCase(colName):    colIdx   = c
            Case "month":           monthIdx = c
            Case "association_id":  assocIdx = c
        End Select
    Next c
    If colIdx = 0 Or monthIdx = 0 Then Exit Function

    ' Collect rows (SQL delivers DESC order)
    Dim tmpV(500) As Double
    Dim tmpN(500) As Integer    ' count for averaging
    Dim tmpM(500) As String
    Dim cnt As Integer: cnt = 0

    Dim i As Long
    For i = rng.Row To rng.Row + rng.Rows.Count - 1
        Dim mv As String: mv = CStr(wsDados.Cells(i, monthIdx).Value)
        If Len(mv) < 4 Then Exit For

        If mv <= Format(Now, "yyyy-mm") Then
            Dim match As Boolean: match = True
            If assocIdx > 0 And assocId <> "" Then
                match = (CStr(wsDados.Cells(i, assocIdx).Value) = assocId)
            End If

            If match Then
                Dim cv As Variant: cv = wsDados.Cells(i, colIdx).Value
                Dim dv As Double:  dv = IIf(IsNumeric(cv), CDbl(cv), 0)

                If cnt > 0 Then
                    If tmpM(cnt - 1) = mv Then
                        tmpV(cnt - 1) = tmpV(cnt - 1) + dv
                        tmpN(cnt - 1) = tmpN(cnt - 1) + 1
                    Else
                        If cnt >= 500 Then Exit For
                        tmpM(cnt) = mv: tmpV(cnt) = dv: tmpN(cnt) = 1: cnt = cnt + 1
                    End If
                Else
                    If cnt >= 500 Then Exit For
                    tmpM(cnt) = mv: tmpV(cnt) = dv: tmpN(cnt) = 1: cnt = cnt + 1
                End If
            End If
        End If
    Next i

    If cnt = 0 Then Exit Function

    ' Average if requested (e.g. for percentages when combining associations)
    If useAvg Then
        Dim j As Integer
        For j = 0 To cnt - 1
            If tmpN(j) > 1 Then tmpV(j) = tmpV(j) / tmpN(j)
        Next j
    End If

    ' Take up to maxMonths; reverse DESC?ASC
    Dim take As Integer: take = IIf(cnt < maxMonths, cnt, maxMonths)
    Dim result() As Double
    ReDim result(take - 1)
    Dim m As Integer
    For m = 0 To take - 1
        result(m) = tmpV(take - 1 - m)   ' DESC index (take-1) ? ASC index 0
    Next m
    GetMonthlySeries = result
End Function

'=============================================================================
' WEEKLY DATA HELPER - serie semanal do _DADOS via DL_rangeKey (DESC->ASC)
'=============================================================================
Private Function GetWeeklySeries(wsDados As Worksheet, rangeKey As String, _
                                  colName As String, assocId As String, _
                                  maxWeeks As Integer) As Variant
    GetWeeklySeries = Array()

    Dim rng As Range
    On Error Resume Next: Set rng = wsDados.Range("DL_" & rangeKey): On Error GoTo 0
    If rng Is Nothing Then Exit Function

    Dim hRow As Long: hRow = rng.Row - 1
    Dim wColIdx  As Integer: wColIdx  = 0
    Dim wWeekIdx As Integer: wWeekIdx = 0
    Dim wAssocIdx As Integer: wAssocIdx = 0
    Dim wc As Integer
    For wc = 1 To 30
        Select Case LCase(CStr(wsDados.Cells(hRow, wc).Value))
            Case LCase(colName):    wColIdx   = wc
            Case "week":            wWeekIdx  = wc
            Case "association_id":  wAssocIdx = wc
        End Select
    Next wc
    If wColIdx = 0 Or wWeekIdx = 0 Then Exit Function

    Dim wTmpV(200) As Double, wTmpW(200) As String
    Dim wCnt As Integer: wCnt = 0

    Dim wi As Long
    For wi = rng.Row To rng.Row + rng.Rows.Count - 1
        Dim wv As String: wv = CStr(wsDados.Cells(wi, wWeekIdx).Value)
        If Len(wv) < 4 Then Exit For
        Dim wMatch As Boolean: wMatch = True
        If wAssocIdx > 0 And assocId <> "" Then
            wMatch = (CStr(wsDados.Cells(wi, wAssocIdx).Value) = assocId)
        End If
        If wMatch Then
            Dim wCv As Variant: wCv = wsDados.Cells(wi, wColIdx).Value
            Dim wDv As Double:  wDv = IIf(IsNumeric(wCv), CDbl(wCv), 0)
            If wCnt > 0 Then
                If wTmpW(wCnt - 1) = wv Then
                    wTmpV(wCnt - 1) = wTmpV(wCnt - 1) + wDv
                Else
                    If wCnt >= 200 Then Exit For
                    wTmpW(wCnt) = wv: wTmpV(wCnt) = wDv: wCnt = wCnt + 1
                End If
            Else
                wTmpW(wCnt) = wv: wTmpV(wCnt) = wDv: wCnt = wCnt + 1
            End If
        End If
    Next wi

    If wCnt = 0 Then Exit Function

    Dim wTake As Integer: wTake = IIf(wCnt < maxWeeks, wCnt, maxWeeks)
    Dim wResult() As Double
    ReDim wResult(wTake - 1)
    Dim wm As Integer
    For wm = 0 To wTake - 1
        wResult(wm) = wTmpV(wTake - 1 - wm)
    Next wm
    GetWeeklySeries = wResult
End Function

