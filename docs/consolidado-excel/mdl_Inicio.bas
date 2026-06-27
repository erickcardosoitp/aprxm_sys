Attribute VB_Name = "mdl_Inicio"
'=============================================================================
' Aba: INICIO — layout A:S
' Paleta dark: #0D1520 fundo, cards #162030, valores brancos
'
' Colunas:
'  A(1)=margem  B(2)=label esq  C-H(3-8)=pad  I(9)=valor esq
'  J-K(10-11)=gap central
'  L(12)=label dir  M-R(13-18)=pad  S(19)=valor dir
'=============================================================================
Option Explicit

' ── Paleta ───────────────────────────────────────────────────────────────────
Private Const CLR_BG       As Long = 2102541   ' #0D1520
Private Const CLR_CARD     As Long = 3153942   ' #162030
Private Const CLR_CARD_HDR As Long = 4074268   ' #1C2B3E
Private Const CLR_BORDER   As Long = 4731684   ' #243348
Private Const CLR_TEXT_DIM As Long = 10519147  ' #6B82A0
Private Const CLR_WHITE    As Long = 16777215
Private Const CLR_GREEN    As Long = 8445514   ' #4ADE80
Private Const CLR_AMBER    As Long = 5100540   ' #FCD34D
Private Const CLR_RED_VAL  As Long = 7434744   ' #F87171
Private Const CLR_ALERT_BG As Long = 1184301   ' #2D1212
Private Const CLR_ALERT    As Long = 4079333   ' #E53E3E
Private Const CLR_ACCENT   As Long = 2776744   ' #2A5298

' Layout — colunas dos cards
Private Const C_L_LBL As Long = 2    ' B
Private Const C_L_VAL As Long = 9    ' I
Private Const C_R_LBL As Long = 12   ' L
Private Const C_R_VAL As Long = 19   ' S

Private m_FilterMes   As String
Private m_FilterAssoc As String


'=============================================================================
' PopulateInicio
'=============================================================================
Public Sub PopulateInicio()
    Dim ws      As Worksheet
    Dim wsDados As Worksheet
    On Error GoTo ErrHandler
    Set ws      = ThisWorkbook.Sheets("INICIO")
    Set wsDados = ThisWorkbook.Sheets("_DADOS")
    Application.ScreenUpdating = False
    Application.Calculation    = xlCalculationManual
    If Not (m_FilterMes Like "####-##") Then m_FilterMes = Format(Now, "yyyy-mm")
    If m_FilterAssoc = "" Then m_FilterAssoc = "Todas"
    ws.Cells.UnMerge
    Dim chObj As ChartObject
    For Each chObj In ws.ChartObjects
        On Error Resume Next: chObj.Delete: On Error GoTo 0
    Next chObj
    ws.Cells.ClearContents
    ws.Cells.ClearFormats
    Call SetupLayout(ws)
    Call WriteHeader(ws, wsDados)
    Call WriteFinanceiroBlock(ws, wsDados)
    Call WriteMensalidadesBlock(ws, wsDados)
    Call WriteMoradoresBlock(ws, wsDados)
    Call WriteOperacoesBlock(ws, wsDados)
    Call WriteAlertsBlock(ws, wsDados)
    Call WriteChartBlock(ws, wsDados)
    Application.Calculation    = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub
ErrHandler:
    Application.Calculation    = xlCalculationAutomatic
    Application.ScreenUpdating = True
    MsgBox "Erro em PopulateInicio: " & Err.Description, vbCritical
End Sub


'=============================================================================
' Slicers callbacks
'=============================================================================
Public Sub ClickFilterPeriodo()
    Dim caller As Variant: caller = Application.Caller
    If VarType(caller) = vbString Then
        Dim n As String: n = CStr(caller)
        If Left(n, 3) = "FP_" Then m_FilterMes = Mid(n, 4)
    End If
    Call PopulateInicio
End Sub

Public Sub ClickFilterAssoc()
    Dim caller As Variant: caller = Application.Caller
    If VarType(caller) = vbString Then
        Dim n As String: n = CStr(caller)
        If Left(n, 3) = "FA_" Then
            Select Case Mid(n, 4)
                Case "Congonha": m_FilterAssoc = "Congonha"
                Case "VazLobo":  m_FilterAssoc = "Vaz Lobo"
                Case Else:       m_FilterAssoc = Mid(n, 4)
            End Select
        End If
    End If
    Call PopulateInicio
End Sub


'=============================================================================
' Layout — colunas A(1) ate S(19)
'=============================================================================
Private Sub SetupLayout(ws As Worksheet)
    ws.Columns(1).ColumnWidth  = 1.5   ' A margem
    ws.Columns(2).ColumnWidth  = 32    ' B label esq
    ws.Columns(3).ColumnWidth  = 3
    ws.Columns(4).ColumnWidth  = 3
    ws.Columns(5).ColumnWidth  = 3
    ws.Columns(6).ColumnWidth  = 3
    ws.Columns(7).ColumnWidth  = 3
    ws.Columns(8).ColumnWidth  = 3
    ws.Columns(9).ColumnWidth  = 24    ' I valor esq
    ws.Columns(10).ColumnWidth = 2     ' J gap
    ws.Columns(11).ColumnWidth = 2     ' K gap
    ws.Columns(12).ColumnWidth = 32    ' L label dir
    ws.Columns(13).ColumnWidth = 3
    ws.Columns(14).ColumnWidth = 3
    ws.Columns(15).ColumnWidth = 3
    ws.Columns(16).ColumnWidth = 3
    ws.Columns(17).ColumnWidth = 3
    ws.Columns(18).ColumnWidth = 3
    ws.Columns(19).ColumnWidth = 24    ' S valor dir

    ws.Rows(1).RowHeight  = 36
    ws.Rows(2).RowHeight  = 20
    ws.Rows(3).RowHeight  = 30
    ws.Rows(4).RowHeight  = 16
    ws.Rows(5).RowHeight  = 10
    ws.Rows(6).RowHeight  = 24
    ws.Rows(7).RowHeight  = 22
    ws.Rows(8).RowHeight  = 22
    ws.Rows(9).RowHeight  = 22
    ws.Rows(10).RowHeight = 22
    ws.Rows(11).RowHeight = 8
    ws.Rows(12).RowHeight = 12
    ws.Rows(13).RowHeight = 24
    ws.Rows(14).RowHeight = 22
    ws.Rows(15).RowHeight = 22
    ws.Rows(16).RowHeight = 22
    ws.Rows(17).RowHeight = 22
    ws.Rows(18).RowHeight = 8
    ws.Rows(19).RowHeight = 12
    ws.Rows(20).RowHeight = 22
    ws.Rows(21).RowHeight = 20
    ws.Rows(22).RowHeight = 20
    ws.Rows(23).RowHeight = 20
    ws.Rows(24).RowHeight = 24   ' chart header
    ws.Rows(25).RowHeight = 12
    ws.Rows(26).RowHeight = 160  ' chart body
    ws.Rows(27).RowHeight = 8

    ws.Range(ws.Cells(1, 1), ws.Cells(30, 20)).Interior.Color = CLR_BG
End Sub


'=============================================================================
' Cabecalho
'=============================================================================
Private Sub WriteHeader(ws As Worksheet, wsDados As Worksheet)
    ws.Range(ws.Cells(1, 2), ws.Cells(1, 19)).Merge
    With ws.Cells(1, 2)
        .Value               = "  APRXM    Consolidado Executivo    " & Format(Now, "dd/mm/yyyy  hh:mm")
        .Font.Name           = "Calibri": .Font.Bold = True: .Font.Size = 13
        .Font.Color          = CLR_WHITE: .Interior.Color = CLR_BG
        .HorizontalAlignment = xlLeft:   .VerticalAlignment = xlCenter
    End With
    With ws.Range(ws.Cells(1, 2), ws.Cells(1, 19)).Borders(xlEdgeBottom)
        .LineStyle = xlContinuous: .Weight = xlThin: .Color = CLR_BORDER
    End With

    ws.Range(ws.Cells(2, 2), ws.Cells(2, 19)).Merge
    Dim sub2 As String
    If m_FilterAssoc = "Todas" Then
        sub2 = "  Todas as associacoes  —  " & m_FilterMes
    Else
        sub2 = "  " & m_FilterAssoc & "  —  " & m_FilterMes
    End If
    With ws.Cells(2, 2)
        .Value = sub2: .Font.Name = "Calibri": .Font.Size = 9
        .Font.Color = CLR_TEXT_DIM: .Interior.Color = CLR_BG
        .HorizontalAlignment = xlLeft: .VerticalAlignment = xlCenter
    End With

    Call WriteSlicerRow(ws, wsDados)

    ws.Range(ws.Cells(4, 2), ws.Cells(4, 19)).Merge
    With ws.Cells(4, 2)
        .Value = "  " & ChrW(8220) & "Em uma linha, qual e a saude da associacao hoje?" & ChrW(8221)
        .Font.Name = "Calibri": .Font.Italic = True: .Font.Size = 9
        .Font.Color = CLR_TEXT_DIM: .Interior.Color = CLR_BG
        .HorizontalAlignment = xlLeft: .VerticalAlignment = xlCenter
    End With
End Sub


'=============================================================================
' Slicers
'=============================================================================
Private Sub WriteSlicerRow(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 3
    ws.Range(ws.Cells(r, 1), ws.Cells(r, 20)).Interior.Color = CLR_CARD

    ' Limpa shapes antigos
    Dim delN(100) As String
    Dim nDel As Integer: nDel = 0
    Dim shp As Shape
    For Each shp In ws.Shapes
        If Left(shp.Name, 3) = "FP_" Or Left(shp.Name, 3) = "FA_" Then
            delN(nDel) = shp.Name: nDel = nDel + 1
        End If
    Next shp
    Dim k As Integer
    For k = 0 To nDel - 1
        On Error Resume Next: ws.Shapes(delN(k)).Delete: On Error GoTo 0
    Next k

    Dim rTop As Double: rTop = ws.Rows(r).Top
    Dim bH   As Double: bH   = ws.Rows(r).Height - 8
    Dim bY   As Double: bY   = rTop + 4

    ' Periodo — ancora em coluna B
    Dim monthStr As String: monthStr = BuildMonthList(wsDados)
    Dim months() As String: months = Split(monthStr, ",")
    Dim nM  As Integer: nM  = UBound(months) + 1
    Dim bWp As Double
    Select Case True
        Case nM <= 3: bWp = 70
        Case nM <= 5: bWp = 62
        Case Else:    bWp = 55
    End Select
    Dim gP  As Double: gP  = 5
    Dim x0P As Double: x0P = ws.Columns(2).Left + 6

    Dim i As Integer
    For i = 0 To nM - 1
        Dim mes As String: mes = Trim(months(i))
        If Len(mes) = 0 Then Exit For
        Dim isSel As Boolean: isSel = (mes = m_FilterMes)
        Dim shpP As Shape
        Set shpP = ws.Shapes.AddShape(msoShapeRoundedRectangle, _
            x0P + i * (bWp + gP), bY, bWp, bH)
        shpP.Name = "FP_" & mes
        shpP.Fill.Solid
        shpP.Fill.ForeColor.RGB = IIf(isSel, RGB(28, 43, 62), RGB(22, 32, 48))
        shpP.Line.ForeColor.RGB = IIf(isSel, RGB(58, 88, 128), RGB(36, 51, 72))
        shpP.Line.Weight        = IIf(isSel, 1.5, 0.5)
        With shpP.TextFrame
            .HorizontalAlignment = xlHAlignCenter: .VerticalAlignment = xlVAlignCenter
            .MarginTop = 0: .MarginBottom = 0: .MarginLeft = 1: .MarginRight = 1
        End With
        With shpP.TextFrame.Characters
            .Text = mes: .Font.Size = 8: .Font.Bold = isSel
            .Font.Color = IIf(isSel, RGB(255, 255, 255), RGB(107, 130, 160))
        End With
        shpP.OnAction = "mdl_Inicio.ClickFilterPeriodo"
    Next i

    ' Associacao — ancora em coluna L
    Dim aLbl(2) As String: aLbl(0) = "Todas": aLbl(1) = "Congonha": aLbl(2) = "Vaz Lobo"
    Dim aKey(2) As String: aKey(0) = "Todas": aKey(1) = "Congonha": aKey(2) = "VazLobo"
    Dim bWa As Double: bWa = 88
    Dim gA  As Double: gA  = 5
    Dim x0A As Double: x0A = ws.Columns(12).Left + 6

    Dim j As Integer
    For j = 0 To 2
        Dim isA As Boolean: isA = (aLbl(j) = m_FilterAssoc)
        Dim shpA As Shape
        Set shpA = ws.Shapes.AddShape(msoShapeRoundedRectangle, _
            x0A + j * (bWa + gA), bY, bWa, bH)
        shpA.Name = "FA_" & aKey(j)
        shpA.Fill.Solid
        shpA.Fill.ForeColor.RGB = IIf(isA, RGB(28, 43, 62), RGB(22, 32, 48))
        shpA.Line.ForeColor.RGB = IIf(isA, RGB(58, 88, 128), RGB(36, 51, 72))
        shpA.Line.Weight        = IIf(isA, 1.5, 0.5)
        With shpA.TextFrame
            .HorizontalAlignment = xlHAlignCenter: .VerticalAlignment = xlVAlignCenter
            .MarginTop = 0: .MarginBottom = 0: .MarginLeft = 2: .MarginRight = 2
        End With
        With shpA.TextFrame.Characters
            .Text = aLbl(j): .Font.Size = 8: .Font.Bold = isA
            .Font.Color = IIf(isA, RGB(255, 255, 255), RGB(107, 130, 160))
        End With
        shpA.OnAction = "mdl_Inicio.ClickFilterAssoc"
    Next j
End Sub


'=============================================================================
' FINANCEIRO — esquerda linhas 6-9
' Taxa e inadimplente usam DL_TAXA_COBRANCA (tem month) — historico correto
'=============================================================================
Private Sub WriteFinanceiroBlock(ws As Worksheet, wsDados As Worksheet)
    Call DrawBlockHeader(ws, 6, C_L_LBL, C_L_VAL, "FINANCEIRO")

    Dim aF      As String: aF      = GetFilterAssocFull()
    Dim assocId As String: assocId = GetAssocId(wsDados, aF)

    ' Receita — ja e historica (RECEITA_MENSAL tem month)
    Dim receita As Variant
    If aF = "" Then
        receita = GetScalar(wsDados, "RECEITA_MENSAL", "total_income", "month", m_FilterMes)
    Else
        receita = GetScalar2(wsDados, "RECEITA_MENSAL_ASSOC", "total_income", _
                             "month", m_FilterMes, "association_name", aF)
    End If
    Call DrawKpiRow(ws, 7, C_L_LBL, C_L_VAL, "Receita Mes Atual", receita, "R$", CLR_WHITE)

    ' Taxa cobranca — TAXA_COBRANCA filtrado por mes (e opcionalmente assoc)
    Dim pgC As Double: pgC = SumTC(wsDados, "total_pago",  assocId)
    Dim pdC As Double: pdC = SumTC(wsDados, "pendentes",   assocId)
    Dim tx  As Variant: Dim txPct As Double
    If pgC + pdC > 0 Then txPct = Round(pgC / (pgC + pdC) * 100, 1): tx = txPct
    Dim txClr As Long: txClr = IIf(txPct >= 80, CLR_GREEN, IIf(txPct >= 60, CLR_AMBER, CLR_RED_VAL))
    Call DrawKpiRow(ws, 8, C_L_LBL, C_L_VAL, "Taxa de Cobranca", tx, "%", txClr)

    ' Total inadimplente — valor_total - valor_pago de collection_rate (filtrado por mes)
    Dim vT As Double: vT = SumTC(wsDados, "valor_total", assocId)
    Dim vP As Double: vP = SumTC(wsDados, "valor_pago",  assocId)
    Dim ow As Variant: If vT > 0 Then ow = Round(vT - vP, 2)
    Call DrawKpiRow(ws, 9, C_L_LBL, C_L_VAL, "Total Inadimplente", ow, "R$", CLR_RED_VAL)

    Call DrawCardBorder(ws, 6, 9, C_L_LBL, C_L_VAL)
End Sub


'=============================================================================
' MENSALIDADES — direita linhas 6-10
' Pagas/vencidas/valor usam DL_TAXA_COBRANCA (historico por mes)
'=============================================================================
Private Sub WriteMensalidadesBlock(ws As Worksheet, wsDados As Worksheet)
    Call DrawBlockHeader(ws, 6, C_R_LBL, C_R_VAL, "MENSALIDADES")

    Dim aF      As String: aF      = GetFilterAssocFull()
    Dim assocId As String: assocId = GetAssocId(wsDados, aF)

    Dim pgD  As Double: pgD  = SumTC(wsDados, "total_pago", assocId)
    Dim pgV  As Variant: If pgD > 0 Then pgV = CLng(pgD)

    ' Vencidas — collection_rate filtrado por mes (historico)
    Dim vcD As Double: vcD = SumTC(wsDados, "pendentes", assocId)
    Dim vcV As Variant: If vcD > 0 Then vcV = CLng(vcD)

    ' Taxa retencao — KPI_OP (snapshot, filtrado por assoc)
    Dim rt As Variant
    If assocId = "" Then
        rt = GetScalar(wsDados, "KPI_OP", "taxa_retencao_pct", "", "")
    Else
        rt = GetScalar(wsDados, "KPI_OP", "taxa_retencao_pct", "association_id", assocId)
    End If
    Dim rtClr As Long: rtClr = IIf(SafeD(rt) >= 70, CLR_GREEN, IIf(SafeD(rt) >= 50, CLR_AMBER, CLR_RED_VAL))

    Call DrawKpiRow(ws, 7, C_R_LBL, C_R_VAL, "Mensalidades Pagas",   pgV, "n", CLR_GREEN)
    Call DrawKpiRow(ws, 8, C_R_LBL, C_R_VAL, "Mensalidades Vencidas", vcV, "n", CLR_AMBER)
    Call DrawKpiRow(ws, 9, C_R_LBL, C_R_VAL, "Taxa de Retencao",      rt,  "%", rtClr)

    Call DrawCardBorder(ws, 6, 9, C_R_LBL, C_R_VAL)
End Sub


'=============================================================================
' MORADORES — esquerda linhas 13-16 (historico mensal filtrado por mes)
'=============================================================================
Private Sub WriteMoradoresBlock(ws As Worksheet, wsDados As Worksheet)
    Call DrawBlockHeader(ws, 13, C_L_LBL, C_L_VAL, "MORADORES")

    Dim aF      As String: aF      = GetFilterAssocFull()
    Dim assocId As String: assocId = GetAssocId(wsDados, aF)
    Dim t As Variant, mc As Variant, dp As Variant, g As Variant

    If assocId = "" Then
        t  = GetSum(wsDados, "MORADORES_MES", "total",      "month", m_FilterMes)
        mc = GetSum(wsDados, "MORADORES_MES", "members",    "month", m_FilterMes)
        dp = GetSum(wsDados, "MORADORES_MES", "dependents", "month", m_FilterMes)
        g  = GetSum(wsDados, "MORADORES_MES", "guests",     "month", m_FilterMes)
    Else
        t  = GetScalar2(wsDados, "MORADORES_MES", "total",      "month", m_FilterMes, "association_id", assocId)
        mc = GetScalar2(wsDados, "MORADORES_MES", "members",    "month", m_FilterMes, "association_id", assocId)
        dp = GetScalar2(wsDados, "MORADORES_MES", "dependents", "month", m_FilterMes, "association_id", assocId)
        g  = GetScalar2(wsDados, "MORADORES_MES", "guests",     "month", m_FilterMes, "association_id", assocId)
    End If

    Call DrawKpiRow(ws, 14, C_L_LBL, C_L_VAL, "Total de Moradores",    t,  "n", CLR_WHITE)
    Call DrawKpiRow(ws, 15, C_L_LBL, C_L_VAL, "Associados",            mc, "n", CLR_GREEN)
    Call DrawKpiRow(ws, 16, C_L_LBL, C_L_VAL, "Dependentes",           dp, "n", CLR_TEXT_DIM)
    Call DrawKpiRow(ws, 17, C_L_LBL, C_L_VAL, "Visitantes",            g,  "n", CLR_TEXT_DIM)

    Call DrawCardBorder(ws, 13, 17, C_L_LBL, C_L_VAL)
End Sub


'=============================================================================
' PACOTES & OS — direita linhas 13-17
'=============================================================================
Private Sub WriteOperacoesBlock(ws As Worksheet, wsDados As Worksheet)
    Call DrawBlockHeader(ws, 13, C_R_LBL, C_R_VAL, "PACOTES & OS")

    Dim aF      As String: aF      = GetFilterAssocFull()
    Dim assocId As String: assocId = GetAssocId(wsDados, aF)

    Dim pkRec As Variant, pkDw As Variant, osAb As Variant, osFe As Variant
    If assocId = "" Then
        pkRec = GetSum(wsDados, "PACOTES_MES",  "recebidos",      "month", m_FilterMes)
        pkDw  = GetSum(wsDados, "PACOTES_MES",  "avg_dwell_dias", "month", m_FilterMes)
        osAb  = GetSum(wsDados, "OS_MES",       "abertas",        "month", m_FilterMes)
        osFe  = GetSum(wsDados, "OS_MES",       "fechadas",       "month", m_FilterMes)
    Else
        pkRec = GetScalar2(wsDados, "PACOTES_MES", "recebidos",      "month", m_FilterMes, "association_id", assocId)
        pkDw  = GetScalar2(wsDados, "PACOTES_MES", "avg_dwell_dias", "month", m_FilterMes, "association_id", assocId)
        osAb  = GetScalar2(wsDados, "OS_MES",      "abertas",        "month", m_FilterMes, "association_id", assocId)
        osFe  = GetScalar2(wsDados, "OS_MES",      "fechadas",       "month", m_FilterMes, "association_id", assocId)
    End If

    Dim dwClr As Long: dwClr = IIf(SafeD(pkDw) <= 2, CLR_GREEN, IIf(SafeD(pkDw) <= 5, CLR_AMBER, CLR_RED_VAL))

    Call DrawKpiRow(ws, 14, C_R_LBL, C_R_VAL, "Pacotes Recebidos",    pkRec, "n",   CLR_WHITE)
    Call DrawKpiRow(ws, 15, C_R_LBL, C_R_VAL, "Tempo Medio Entrega",  pkDw,  "dias", dwClr)
    Call DrawKpiRow(ws, 16, C_R_LBL, C_R_VAL, "OS Abertas",           osAb,  "n",   CLR_AMBER)
    Call DrawKpiRow(ws, 17, C_R_LBL, C_R_VAL, "OS Fechadas",          osFe,  "n",   CLR_GREEN)

    Call DrawCardBorder(ws, 13, 17, C_R_LBL, C_R_VAL)
End Sub


'=============================================================================
' Alertas — linhas 20-23 (criticos) + 24-26 reservado ao grafico
' Layout: 20=header, 21-23=msgs criticas; alertas presidencia em bloco separado
'=============================================================================
Private Sub WriteAlertsBlock(ws As Worksheet, wsDados As Worksheet)
    Dim msgs(20) As String
    Dim nMsgs    As Integer: nMsgs = 0

    Dim aF      As String: aF      = GetFilterAssocFull()
    Dim assocId As String: assocId = GetAssocId(wsDados, aF)

    ' ── Pacotes parados ────────────────────────────────────────────────────────
    Dim stuck As Variant
    If assocId = "" Then
        stuck = GetSum(wsDados, "PACOTES_STUCK", "total")
    Else
        stuck = GetSum(wsDados, "PACOTES_STUCK", "total", "association_id", assocId)
    End If
    If Not IsEmpty(stuck) And SafeD(stuck) > 5 Then
        msgs(nMsgs) = ChrW(9888) & "  " & CLng(stuck) & " pacotes parados ha mais de 3 dias"
        nMsgs = nMsgs + 1
    End If

    ' ── Taxa de cobranca ───────────────────────────────────────────────────────
    Dim pgC As Double: pgC = SumTC(wsDados, "total_pago",  assocId)
    Dim pdC As Double: pdC = SumTC(wsDados, "pendentes",   assocId)
    If pgC + pdC > 0 Then
        Dim pct As Double: pct = pgC / (pgC + pdC) * 100
        If pct < 60 Then
            msgs(nMsgs) = ChrW(9888) & "  Taxa de cobranca " & Format(pct, "0.0") & "% — abaixo de 60%"
            nMsgs = nMsgs + 1
        End If
    End If

    ' ── Anomalias de caixa — para a presidencia ────────────────────────────────
    Dim rngCS As Range
    On Error Resume Next: Set rngCS = wsDados.Range("DL_CAIXA_ANOMALIAS"): On Error GoTo 0
    If Not rngCS Is Nothing Then
        Dim hCS As Long: hCS = rngCS.Row - 1
        Dim cOp As Integer: cOp = 0
        Dim cAn As Integer: cAn = 0
        Dim cDi As Integer: cDi = 0
        Dim cAss As Integer: cAss = 0
        Dim c As Integer
        For c = 1 To 20
            Select Case LCase(wsDados.Cells(hCS, c).Value)
                Case "operador_name":   cOp  = c
                Case "anomalia":        cAn  = c
                Case "dia":             cDi  = c
                Case "association_id":  cAss = c
            End Select
        Next c
        If cOp > 0 And cAn > 0 Then
            ' Conta caixas abertos sem fechar (critico)
            Dim nAbertos As Integer: nAbertos = 0
            Dim nProxDia As Integer: nProxDia = 0
            Dim opAberto As String
            Dim i As Long
            For i = rngCS.Row To rngCS.Row + rngCS.Rows.Count - 1
                If assocId = "" Or cAss = 0 Or _
                   CStr(wsDados.Cells(i, cAss).Value) = assocId Then
                    Select Case CStr(wsDados.Cells(i, cAn).Value)
                        Case "ABERTO_SEM_FECHAR"
                            nAbertos = nAbertos + 1
                            If opAberto = "" Then opAberto = CStr(wsDados.Cells(i, cOp).Value)
                        Case "FECHOU_DIA_SEGUINTE"
                            nProxDia = nProxDia + 1
                    End Select
                End If
            Next i
            If nAbertos > 0 Then
                Dim abMsg As String
                If nAbertos = 1 Then
                    abMsg = ChrW(9888) & "  CAIXA ABERTO: " & opAberto & " nao fechou o caixa"
                Else
                    abMsg = ChrW(9888) & "  " & nAbertos & " CAIXAS ABERTOS sem fechamento"
                End If
                msgs(nMsgs) = abMsg: nMsgs = nMsgs + 1
            End If
            If nProxDia >= 3 Then
                msgs(nMsgs) = ChrW(9888) & "  " & nProxDia & " caixas fechados no dia seguinte (ultimos 30d)"
                nMsgs = nMsgs + 1
            End If
        End If
    End If

    ' ── Renderiza bloco de alertas ─────────────────────────────────────────────
    Dim alertBg As Long: alertBg = IIf(nMsgs > 0, CLR_ALERT_BG, CLR_CARD)
    Dim alertFg As Long: alertFg = IIf(nMsgs > 0, CLR_ALERT, CLR_GREEN)
    Dim nRows   As Integer: nRows = Application.Max(3, nMsgs + 1)
    ws.Range(ws.Cells(20, 1), ws.Cells(20 + nRows, 20)).Interior.Color = alertBg

    If nMsgs > 0 Then
        With ws.Range(ws.Cells(20, 2), ws.Cells(20, 19)).Borders(xlEdgeTop)
            .LineStyle = xlContinuous: .Weight = xlMedium: .Color = CLR_ALERT
        End With
    End If

    With ws.Cells(20, 2)
        .Value = "  ALERTAS PARA A PRESIDENCIA"
        .Font.Bold = True: .Font.Size = 8: .Font.Name = "Calibri"
        .Font.Color = alertFg: .Interior.Color = alertBg
        .VerticalAlignment = xlCenter: .HorizontalAlignment = xlLeft
    End With

    If nMsgs = 0 Then
        With ws.Cells(21, 2)
            .Value = "  " & ChrW(10003) & "  Sem alertas criticos"
            .Font.Color = CLR_GREEN: .Font.Size = 9: .Font.Name = "Calibri"
            .Interior.Color = alertBg
        End With
    Else
        Dim idx As Integer
        For idx = 0 To nMsgs - 1
            With ws.Cells(21 + idx, 2)
                .Value = "  " & msgs(idx)
                .Font.Color = CLR_RED_VAL: .Font.Size = 9: .Font.Name = "Calibri"
                .Interior.Color = alertBg
            End With
        Next idx
    End If
End Sub


'=============================================================================
' DrawBlockHeader
'=============================================================================
Private Sub DrawBlockHeader(ws As Worksheet, rowNum As Long, _
                             lblCol As Long, valCol As Long, title As String)
    Dim rng As Range
    Set rng = ws.Range(ws.Cells(rowNum, lblCol), ws.Cells(rowNum, valCol))
    rng.Interior.Color = CLR_CARD_HDR

    With ws.Cells(rowNum, lblCol)
        .Value = "  " & title
        .Font.Bold = True: .Font.Size = 8: .Font.Name = "Calibri"
        .Font.Color = CLR_TEXT_DIM
        .VerticalAlignment = xlCenter: .HorizontalAlignment = xlLeft
    End With
    With rng.Borders(xlEdgeTop)
        .LineStyle = xlContinuous: .Weight = xlMedium: .Color = CLR_ACCENT
    End With
    With rng.Borders(xlEdgeBottom)
        .LineStyle = xlContinuous: .Weight = xlThin: .Color = CLR_BORDER
    End With
End Sub


'=============================================================================
' DrawKpiRow
'=============================================================================
Private Sub DrawKpiRow(ws As Worksheet, rowNum As Long, _
                        lblCol As Long, valCol As Long, _
                        label As String, valor As Variant, fmt As String, _
                        Optional vClr As Long = -1)
    If vClr = -1 Then vClr = CLR_WHITE
    ws.Range(ws.Cells(rowNum, lblCol), ws.Cells(rowNum, valCol)).Interior.Color = CLR_CARD

    With ws.Cells(rowNum, lblCol)
        .Value = "  " & label: .Font.Size = 8: .Font.Color = CLR_TEXT_DIM
        .Interior.Color = CLR_CARD
        .VerticalAlignment = xlCenter: .HorizontalAlignment = xlLeft
        .Font.Name = "Calibri"
    End With

    Dim dv As String
    Dim useClr As Long: useClr = vClr
    If IsEmpty(valor) Or IsNull(valor) Or CStr(valor) = "" Then
        dv = ChrW(8212): useClr = CLR_TEXT_DIM
    Else
        Select Case fmt
            Case "R$":    dv = "R$ " & Format(CDbl(valor), "#,##0.00")
            Case "%":     dv = Format(CDbl(valor), "0.0") & "%"
            Case "meses": dv = Format(CDbl(valor), "0.0") & " m"
            Case "dias":  dv = Format(CDbl(valor), "0.0") & " d"
            Case "n"
                If IsNumeric(valor) Then dv = Format(CLng(valor), "#,##0") Else dv = CStr(valor)
            Case Else:    dv = CStr(valor)
        End Select
    End If

    With ws.Cells(rowNum, valCol)
        .Value = dv: .Font.Bold = True: .Font.Size = 15
        .Font.Color = useClr: .Interior.Color = CLR_CARD
        .HorizontalAlignment = xlRight: .VerticalAlignment = xlCenter
        .Font.Name = "Calibri"
    End With
End Sub


'=============================================================================
' DrawCardBorder
'=============================================================================
Private Sub DrawCardBorder(ws As Worksheet, r1 As Long, r2 As Long, _
                            lblCol As Long, valCol As Long)
    Dim rng As Range
    Set rng = ws.Range(ws.Cells(r1, lblCol), ws.Cells(r2, valCol))
    With rng.Borders(xlEdgeBottom)
        .LineStyle = xlContinuous: .Weight = xlThin: .Color = CLR_BORDER
    End With
    With rng.Borders(xlEdgeLeft)
        .LineStyle = xlContinuous: .Weight = xlThin: .Color = CLR_BORDER
    End With
    With rng.Borders(xlEdgeRight)
        .LineStyle = xlContinuous: .Weight = xlThin: .Color = CLR_BORDER
    End With
End Sub


'=============================================================================
' SumTC — soma coluna de DL_TAXA_COBRANCA filtrada por m_FilterMes e assocId
' Se assocId = "" soma todas as associacoes para o mes selecionado
'=============================================================================
Private Function SumTC(wsDados As Worksheet, colName As String, _
                        assocId As String) As Double
    Dim rng As Range
    On Error Resume Next: Set rng = wsDados.Range("DL_TAXA_COBRANCA"): On Error GoTo 0
    If rng Is Nothing Then SumTC = 0: Exit Function

    Dim hRow As Long: hRow = rng.Row - 1
    Dim ci As Integer: ci = 0
    Dim cm As Integer: cm = 0
    Dim ca As Integer: ca = 0
    Dim c As Integer
    For c = 1 To 30
        Select Case LCase(wsDados.Cells(hRow, c).Value)
            Case LCase(colName):      ci = c
            Case "month":             cm = c
            Case "association_id":    ca = c
        End Select
    Next c
    If ci = 0 Or cm = 0 Then SumTC = 0: Exit Function

    Dim total As Double: total = 0
    Dim i As Long
    For i = rng.Row To rng.Row + rng.Rows.Count - 1
        If CStr(wsDados.Cells(i, cm).Value) = m_FilterMes Then
            If assocId = "" Or ca = 0 Or _
               CStr(wsDados.Cells(i, ca).Value) = assocId Then
                If IsNumeric(wsDados.Cells(i, ci).Value) Then
                    total = total + CDbl(wsDados.Cells(i, ci).Value)
                End If
            End If
        End If
    Next i
    SumTC = total
End Function


'=============================================================================
' GetScalar / GetScalar2 / GetSum / SafeD
'=============================================================================
Public Function GetScalar(wsDados As Worksheet, rangeKey As String, _
                           colName As String, filterCol As String, filterVal As String) As Variant
    Dim rng As Range
    On Error Resume Next: Set rng = wsDados.Range("DL_" & rangeKey): On Error GoTo 0
    If rng Is Nothing Then GetScalar = Empty: Exit Function
    Dim hRow As Long: hRow = rng.Row - 1
    Dim ci As Integer: ci = 0: Dim fi As Integer: fi = 0: Dim c As Integer
    For c = 1 To 50
        Dim h As String: h = LCase(wsDados.Cells(hRow, c).Value)
        If h = LCase(colName) Then ci = c
        If Len(filterCol) > 0 And h = LCase(filterCol) Then fi = c
        If ci > 0 And (Len(filterCol) = 0 Or fi > 0) Then Exit For
    Next c
    If ci = 0 Then GetScalar = Empty: Exit Function
    Dim i As Long
    For i = rng.Row To rng.Row + rng.Rows.Count - 1
        If fi > 0 Then
            If CStr(wsDados.Cells(i, fi).Value) = filterVal Then
                GetScalar = wsDados.Cells(i, ci).Value: Exit Function
            End If
        Else
            GetScalar = wsDados.Cells(i, ci).Value: Exit Function
        End If
    Next i
    GetScalar = Empty
End Function

Public Function GetSum(wsDados As Worksheet, rangeKey As String, colName As String, _
                       Optional filterCol As String = "", Optional filterVal As String = "") As Variant
    Dim rng As Range
    On Error Resume Next: Set rng = wsDados.Range("DL_" & rangeKey): On Error GoTo 0
    If rng Is Nothing Then GetSum = Empty: Exit Function
    Dim hRow As Long: hRow = rng.Row - 1
    Dim ci As Integer: ci = 0: Dim fi As Integer: fi = 0: Dim c As Integer
    For c = 1 To 50
        Dim h As String: h = LCase(wsDados.Cells(hRow, c).Value)
        If h = LCase(colName) Then ci = c
        If Len(filterCol) > 0 And h = LCase(filterCol) Then fi = c
    Next c
    If ci = 0 Then GetSum = Empty: Exit Function
    Dim total As Double: total = 0: Dim i As Long
    For i = rng.Row To rng.Row + rng.Rows.Count - 1
        If fi > 0 Then
            If CStr(wsDados.Cells(i, fi).Value) = filterVal Then
                total = total + SafeD(wsDados.Cells(i, ci).Value)
            End If
        Else
            total = total + SafeD(wsDados.Cells(i, ci).Value)
        End If
    Next i
    GetSum = total
End Function

Public Function GetScalar2(wsDados As Worksheet, rangeKey As String, colName As String, _
                            f1Col As String, f1Val As String, _
                            f2Col As String, f2Val As String) As Variant
    Dim rng As Range
    On Error Resume Next: Set rng = wsDados.Range("DL_" & rangeKey): On Error GoTo 0
    If rng Is Nothing Then GetScalar2 = Empty: Exit Function
    Dim hRow As Long: hRow = rng.Row - 1
    Dim ci As Integer: ci = 0: Dim f1 As Integer: f1 = 0: Dim f2 As Integer: f2 = 0: Dim c As Integer
    For c = 1 To 50
        Dim h As String: h = LCase(wsDados.Cells(hRow, c).Value)
        If h = LCase(colName) Then ci = c
        If h = LCase(f1Col) Then f1 = c
        If h = LCase(f2Col) Then f2 = c
    Next c
    If ci = 0 Then GetScalar2 = Empty: Exit Function
    Dim i As Long
    For i = rng.Row To rng.Row + rng.Rows.Count - 1
        Dim o1 As Boolean: o1 = (f1 = 0) Or (CStr(wsDados.Cells(i, f1).Value) = f1Val)
        Dim o2 As Boolean: o2 = (f2 = 0) Or (CStr(wsDados.Cells(i, f2).Value) = f2Val)
        If o1 And o2 Then GetScalar2 = wsDados.Cells(i, ci).Value: Exit Function
    Next i
    GetScalar2 = Empty
End Function

Public Function SafeD(v As Variant) As Double
    If IsEmpty(v) Or IsNull(v) Or Not IsNumeric(v) Then SafeD = 0 Else SafeD = CDbl(v)
End Function


'=============================================================================
' GRÁFICO — Receita Semanal (últimas 12 semanas, 3 linhas: Total / VL / Congonha)
'=============================================================================
Private Sub WriteChartBlock(ws As Worksheet, wsDados As Worksheet)
    Const N_WEEKS As Integer = 12

    ' Header da secao
    Dim hRng As Range
    Set hRng = ws.Range(ws.Cells(24, C_L_LBL), ws.Cells(24, C_R_VAL))
    hRng.Interior.Color = CLR_CARD_HDR
    With ws.Cells(24, C_L_LBL)
        .Value = "  RECEITA SEMANAL  (ultimas " & N_WEEKS & " semanas)"
        .Font.Bold = True: .Font.Size = 8: .Font.Name = "Calibri"
        .Font.Color = CLR_TEXT_DIM
        .VerticalAlignment = xlCenter: .HorizontalAlignment = xlLeft
    End With
    With hRng.Borders(xlEdgeTop)
        .LineStyle = xlContinuous: .Weight = xlMedium: .Color = CLR_ACCENT
    End With

    ' Fonte de dados
    Dim rng As Range
    On Error Resume Next: Set rng = wsDados.Range("DL_RECEITA_DIARIA"): On Error GoTo 0
    If rng Is Nothing Then Exit Sub

    Dim hRow As Long: hRow = rng.Row - 1
    Dim cW As Integer: cW = 0
    Dim cA As Integer: cA = 0
    Dim cI As Integer: cI = 0
    Dim c As Integer
    For c = 1 To 30
        Select Case LCase(wsDados.Cells(hRow, c).Value)
            Case "week":             cW = c
            Case "association_name": cA = c
            Case "total_income":     cI = c
        End Select
    Next c
    If cW = 0 Or cA = 0 Or cI = 0 Then Exit Sub

    ' Encontra a semana maxima nos dados
    Dim maxWk As String: maxWk = ""
    Dim i As Long
    For i = rng.Row To rng.Row + rng.Rows.Count - 1
        Dim wk As String: wk = CStr(wsDados.Cells(i, cW).Value)
        If Len(wk) = 10 And wk > maxWk Then maxWk = wk
    Next i
    If Len(maxWk) = 0 Then Exit Sub

    ' Gera lista de semanas (locale-safe via DateSerial)
    Dim maxDate As Date
    maxDate = DateSerial(CInt(Left(maxWk, 4)), CInt(Mid(maxWk, 6, 2)), CInt(Right(maxWk, 2)))

    Dim weekList(N_WEEKS - 1) As String
    Dim vlData(N_WEEKS - 1)   As Double
    Dim cgData(N_WEEKS - 1)   As Double
    Dim totData(N_WEEKS - 1)  As Double
    Dim xLabels(N_WEEKS - 1)  As String
    Dim w As Integer
    For w = 0 To N_WEEKS - 1
        weekList(N_WEEKS - 1 - w) = Format(maxDate - w * 7, "YYYY-MM-DD")
        xLabels(N_WEEKS - 1 - w)  = Format(maxDate - w * 7, "DD/MM")
    Next w

    ' Agrega receita por (semana, associacao)
    For i = rng.Row To rng.Row + rng.Rows.Count - 1
        wk = CStr(wsDados.Cells(i, cW).Value)
        Dim aName As String: aName = CStr(wsDados.Cells(i, cA).Value)
        Dim inc As Double
        If IsNumeric(wsDados.Cells(i, cI).Value) Then inc = CDbl(wsDados.Cells(i, cI).Value)
        For w = 0 To N_WEEKS - 1
            If weekList(w) = wk Then
                totData(w) = totData(w) + inc
                If InStr(1, aName, "Lobo",     vbTextCompare) > 0 Then vlData(w) = vlData(w) + inc
                If InStr(1, aName, "Congonha", vbTextCompare) > 0 Then cgData(w) = cgData(w) + inc
                Exit For
            End If
        Next w
    Next i

    ' Remove grafico anterior
    On Error Resume Next: ws.ChartObjects("ChartReceita").Delete: On Error GoTo 0

    ' Posiciona o grafico na area de linhas 25-26
    Dim cTop    As Double: cTop    = ws.Rows(25).Top
    Dim cLeft   As Double: cLeft   = ws.Columns(C_L_LBL).Left
    Dim cWidth  As Double: cWidth  = ws.Columns(C_R_VAL).Left + ws.Columns(C_R_VAL).Width - cLeft
    Dim cHeight As Double: cHeight = ws.Rows(26).Height - 4

    Dim co As ChartObject
    Set co = ws.ChartObjects.Add(cLeft, cTop, cWidth, cHeight)
    co.Name = "ChartReceita"

    With co.Chart
        .ChartType = xlLine

        ' Fundo dark — .Solid + .ForeColor.RGB e obrigatorio para fill solido estavel
        .ChartArea.Format.Fill.Solid
        .ChartArea.Format.Fill.ForeColor.RGB = RGB(13, 21, 32)
        .ChartArea.Format.Line.Visible       = msoFalse
        .PlotArea.Format.Fill.Solid
        .PlotArea.Format.Fill.ForeColor.RGB  = RGB(22, 32, 48)
        .PlotArea.Format.Line.Visible        = msoFalse

        .HasTitle = False

        ' Remove series padrao
        Do While .SeriesCollection.Count > 0
            .SeriesCollection(1).Delete
        Loop

        ' Serie: Total (branco)
        Dim s1 As Series: Set s1 = .SeriesCollection.NewSeries
        s1.Name = "Total": s1.XValues = xLabels: s1.Values = totData
        s1.Format.Line.ForeColor.RGB = RGB(255, 255, 255)
        s1.Format.Line.Weight = 2.5
        s1.MarkerStyle = xlMarkerStyleNone

        ' Serie: Vaz Lobo (verde)
        Dim s2 As Series: Set s2 = .SeriesCollection.NewSeries
        s2.Name = "Vaz Lobo": s2.XValues = xLabels: s2.Values = vlData
        s2.Format.Line.ForeColor.RGB = RGB(74, 222, 128)
        s2.Format.Line.Weight = 1.75
        s2.MarkerStyle = xlMarkerStyleNone

        ' Serie: Congonha (azul)
        Dim s3 As Series: Set s3 = .SeriesCollection.NewSeries
        s3.Name = "Congonha": s3.XValues = xLabels: s3.Values = cgData
        s3.Format.Line.ForeColor.RGB = RGB(96, 165, 250)
        s3.Format.Line.Weight = 1.75
        s3.MarkerStyle = xlMarkerStyleNone

        ' Eixo X
        With .Axes(xlCategory)
            .TickLabels.Font.Color = RGB(107, 130, 160)
            .TickLabels.Font.Size  = 7
            .Format.Line.ForeColor.RGB = RGB(36, 51, 72)
        End With

        ' Eixo Y
        With .Axes(xlValue)
            .TickLabels.Font.Color     = RGB(107, 130, 160)
            .TickLabels.Font.Size      = 7
            .TickLabels.NumberFormat   = "#,##0"
            .Format.Line.Visible       = msoFalse
            With .MajorGridlines.Format.Line
                .ForeColor.RGB  = RGB(36, 51, 72)
                .Transparency   = 0.6
            End With
        End With

        ' Legenda
        .HasLegend = True
        With .Legend
            .Format.Fill.Solid
            .Format.Fill.ForeColor.RGB = RGB(13, 21, 32)
            .Format.Line.Visible       = msoFalse
            .Font.Color = RGB(107, 130, 160)
            .Font.Size  = 8
            .Position   = xlLegendPositionTop
        End With

        ' Rotulos de dados — apenas na serie Total, ultimo ponto visivel
        Dim sT As Series: Set sT = .SeriesCollection(1) ' Total
        sT.HasDataLabels = True
        With sT.DataLabels
            .ShowValue      = True
            .ShowSeriesName = False
            .Font.Color     = RGB(255, 255, 255)
            .Font.Size      = 7
            .Font.Bold      = False
            .NumberFormat   = "#,##0"
            .Position       = xlLabelPositionAbove
        End With
        ' Mostra rotulo apenas no ultimo ponto (maior indice)
        Dim ptIdx As Integer
        For ptIdx = 1 To sT.Points.Count - 1
            sT.Points(ptIdx).DataLabel.Delete
        Next ptIdx
    End With
End Sub


'=============================================================================
' GetFilterAssocFull — le o nome exato do _DADOS para preservar encoding/acentos
'=============================================================================
Private Function GetFilterAssocFull() As String
    If m_FilterAssoc = "" Or m_FilterAssoc = "Todas" Then
        GetFilterAssocFull = "": Exit Function
    End If
    Dim keyword As String
    Select Case m_FilterAssoc
        Case "Congonha": keyword = "Congonha"
        Case "Vaz Lobo": keyword = "Lobo"
        Case Else: GetFilterAssocFull = "": Exit Function
    End Select
    Dim ws As Worksheet
    On Error Resume Next: Set ws = ThisWorkbook.Sheets("_DADOS"): On Error GoTo 0
    If ws Is Nothing Then GetFilterAssocFull = "": Exit Function
    Dim rng As Range
    On Error Resume Next: Set rng = ws.Range("DL_MORADORES_GERAL"): On Error GoTo 0
    If rng Is Nothing Then GetFilterAssocFull = "": Exit Function
    Dim hRow As Long: hRow = rng.Row - 1
    Dim ci As Integer: ci = 0: Dim c As Integer
    For c = 1 To 20
        If LCase(ws.Cells(hRow, c).Value) = "association_name" Then ci = c: Exit For
    Next c
    If ci = 0 Then GetFilterAssocFull = "": Exit Function
    Dim i As Long
    For i = rng.Row To rng.Row + rng.Rows.Count - 1
        Dim v As String: v = CStr(ws.Cells(i, ci).Value)
        If InStr(1, v, keyword, vbTextCompare) > 0 Then
            GetFilterAssocFull = v: Exit Function
        End If
    Next i
    GetFilterAssocFull = ""
End Function


'=============================================================================
' GetAssocId — le association_id do _DADOS pelo nome completo (para TAXA_COBRANCA)
'=============================================================================
Private Function GetAssocId(wsDados As Worksheet, assocFullName As String) As String
    GetAssocId = ""
    If assocFullName = "" Then Exit Function
    Dim rng As Range
    On Error Resume Next: Set rng = wsDados.Range("DL_MORADORES_GERAL"): On Error GoTo 0
    If rng Is Nothing Then Exit Function
    Dim hRow As Long: hRow = rng.Row - 1
    Dim cn As Integer: cn = 0: Dim ci As Integer: ci = 0: Dim c As Integer
    For c = 1 To 20
        Select Case LCase(wsDados.Cells(hRow, c).Value)
            Case "association_name": cn = c
            Case "association_id":   ci = c
        End Select
    Next c
    If cn = 0 Or ci = 0 Then Exit Function
    Dim i As Long
    For i = rng.Row To rng.Row + rng.Rows.Count - 1
        If CStr(wsDados.Cells(i, cn).Value) = assocFullName Then
            GetAssocId = CStr(wsDados.Cells(i, ci).Value): Exit Function
        End If
    Next i
End Function


'=============================================================================
' BuildMonthList — lista meses do DL_RECEITA_MENSAL
'=============================================================================
Private Function BuildMonthList(wsDados As Worksheet) As String
    Dim rng As Range
    On Error Resume Next: Set rng = wsDados.Range("DL_RECEITA_MENSAL"): On Error GoTo 0
    If rng Is Nothing Then BuildMonthList = Format(Now, "yyyy-mm"): Exit Function
    Dim parts(20) As String: Dim n As Integer: n = 0: Dim i As Long
    For i = rng.Row To rng.Row + rng.Rows.Count - 1
        Dim v As String: v = CStr(wsDados.Cells(i, 1).Value)
        If v Like "####-##" Then parts(n) = v: n = n + 1: If n > 20 Then Exit For
    Next i
    If n = 0 Then BuildMonthList = Format(Now, "yyyy-mm"): Exit Function
    Dim res As String: Dim j As Integer
    For j = 0 To n - 1
        If j > 0 Then res = res & ","
        res = res & parts(j)
    Next j
    BuildMonthList = res
End Function
