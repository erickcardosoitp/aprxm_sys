Attribute VB_Name = "mdl_Inicio"
'=============================================================================
' Aba: INICIO — Panorama Geral
' Filtros estilo slicer: shapes FP_ (período) e FA_ (associação)
' Paleta: #141323 primário + branco secundário
'=============================================================================
Option Explicit

Private Const CLR_PRIMARY  As Long = 2298644   ' #141323 RGB(20,19,35)
Private Const CLR_ACCENT   As Long = 11702536  ' #0891B2 RGB(8,145,178)
Private Const CLR_WHITE    As Long = 16777215
Private Const CLR_LIGHT    As Long = 16184563  ' #F3F4F6
Private Const CLR_GREEN    As Long = 4891414   ' #16A34A
Private Const CLR_RED      As Long = 2498780   ' #DC2626
Private Const CLR_GRAY     As Long = 8355179   ' #6B7280
Private Const CLR_FILTER   As Long = 15920880  ' #F2F0F8 slicer bg

' Aliases para compatibilidade com outros módulos que chamam GetScalar/SafeD
Private Const CLR_NAVY     As Long = 2298644
Private Const CLR_CERULEAN As Long = 11702536

' Estado dos filtros (persiste na sessão Excel)
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
    If m_FilterAssoc = ""               Then m_FilterAssoc = "Todas"

    ws.Cells.UnMerge
    ws.Cells.ClearContents
    ws.Cells.ClearFormats

    Call SetupLayout(ws)
    Call WriteHeader(ws, wsDados)
    Call WriteFinanceiroBlock(ws, wsDados)
    Call WriteMensalidadesBlock(ws, wsDados)
    Call WriteMoradoresBlock(ws, wsDados)
    Call WriteOperacoesBlock(ws, wsDados)
    Call WriteAlertsBlock(ws, wsDados)

    Application.Calculation    = xlCalculationAutomatic
    Application.ScreenUpdating = True
    Exit Sub

ErrHandler:
    Application.Calculation    = xlCalculationAutomatic
    Application.ScreenUpdating = True
    MsgBox "Erro em PopulateInicio: " & Err.Description, vbCritical
End Sub


'=============================================================================
' Macros dos shape-slicers (OnAction)
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
                Case "VazLobo": m_FilterAssoc = "Vaz Lobo"
                Case Else:      m_FilterAssoc = Mid(n, 4)
            End Select
        End If
    End If
    Call PopulateInicio
End Sub


'=============================================================================
' Layout (colunas A-I)
'=============================================================================
Private Sub SetupLayout(ws As Worksheet)
    ws.Columns("A").ColumnWidth = 1.5
    ws.Columns("B").ColumnWidth = 24
    ws.Columns("C").ColumnWidth = 18
    ws.Columns("D").ColumnWidth = 2
    ws.Columns("E").ColumnWidth = 2
    ws.Columns("F").ColumnWidth = 2
    ws.Columns("G").ColumnWidth = 24
    ws.Columns("H").ColumnWidth = 18
    ws.Columns("I").ColumnWidth = 1.5

    ws.Rows(1).RowHeight  = 32
    ws.Rows(2).RowHeight  = 20
    ws.Rows(3).RowHeight  = 30   ' slicer row
    ws.Rows(4).RowHeight  = 16   ' pergunta
    ws.Rows(5).RowHeight  = 10
    ws.Rows(6).RowHeight  = 22   ' block header
    ws.Rows(7).RowHeight  = 20
    ws.Rows(8).RowHeight  = 20
    ws.Rows(9).RowHeight  = 20
    ws.Rows(10).RowHeight = 6
    ws.Rows(11).RowHeight = 12
    ws.Rows(12).RowHeight = 22
    ws.Rows(13).RowHeight = 20
    ws.Rows(14).RowHeight = 20
    ws.Rows(15).RowHeight = 20
    ws.Rows(16).RowHeight = 6
    ws.Rows(17).RowHeight = 12
    ws.Rows(18).RowHeight = 22
    ws.Rows(19).RowHeight = 16
    ws.Rows(20).RowHeight = 16
    ws.Rows(21).RowHeight = 16
End Sub


'=============================================================================
' Cabeçalho
'=============================================================================
Private Sub WriteHeader(ws As Worksheet, wsDados As Worksheet)
    ' Linha 1 — título
    ws.Range("B1:H1").Merge
    With ws.Range("B1")
        .Value               = "  APRXM  |  Consolidado Executivo  |  " & Format(Now, "dd/mm/yyyy  hh:mm")
        .Font.Name           = "Calibri"
        .Font.Bold           = True
        .Font.Size           = 12
        .Font.Color          = CLR_WHITE
        .Interior.Color      = CLR_PRIMARY
        .HorizontalAlignment = xlLeft
        .VerticalAlignment   = xlCenter
    End With
    ws.Range("A1").Interior.Color = CLR_PRIMARY
    ws.Range("I1").Interior.Color = CLR_PRIMARY

    ' Linha 2 — associação ativa
    ws.Range("B2:H2").Merge
    Dim sub2 As String
    If m_FilterAssoc = "Todas" Then
        sub2 = "  Assoc. de Moradores Sapê-Vaz Lobo e Buriti-Congonha  —  " & m_FilterMes
    Else
        sub2 = "  " & GetFilterAssocFull() & "  —  " & m_FilterMes
    End If
    With ws.Range("B2")
        .Value               = sub2
        .Font.Name           = "Calibri"
        .Font.Size           = 9
        .Font.Color          = CLR_WHITE
        .Interior.Color      = CLR_ACCENT
        .HorizontalAlignment = xlLeft
        .VerticalAlignment   = xlCenter
    End With
    ws.Range("A2").Interior.Color = CLR_ACCENT
    ws.Range("I2").Interior.Color = CLR_ACCENT

    ' Linha 3 — slicers
    Call WriteSlicerRow(ws, wsDados)

    ' Linha 4 — pergunta
    ws.Range("B4:H4").Merge
    With ws.Range("B4")
        .Value               = "  " & ChrW(8220) & "Em uma linha, qual é a saúde da associação hoje?" & ChrW(8221)
        .Font.Name           = "Calibri"
        .Font.Italic         = True
        .Font.Size           = 9
        .Font.Color          = CLR_ACCENT
        .HorizontalAlignment = xlLeft
        .VerticalAlignment   = xlCenter
    End With
End Sub


'=============================================================================
' Slicers interativos — shapes clicáveis na linha 3
'=============================================================================
Private Sub WriteSlicerRow(ws As Worksheet, wsDados As Worksheet)
    Dim r As Long: r = 3

    ' Fundo
    ws.Range(ws.Cells(r, 1), ws.Cells(r, 9)).Interior.Color = CLR_FILTER

    ' Remove shapes de filtro (coleta nomes primeiro, depois deleta)
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

    '--- PERÍODO (lado esquerdo: B-C area) ---
    Dim monthStr As String: monthStr = BuildMonthList(wsDados)
    Dim months() As String: months = Split(monthStr, ",")
    Dim nM  As Integer: nM  = UBound(months) + 1
    Dim bWp As Double
    Select Case True
        Case nM <= 3: bWp = 64
        Case nM <= 5: bWp = 55
        Case Else:    bWp = 48
    End Select
    Dim gP  As Double: gP  = 4
    Dim x0P As Double: x0P = ws.Columns("B").Left + 4

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
        shpP.Fill.ForeColor.RGB    = IIf(isSel, RGB(20, 19, 35), RGB(215, 213, 235))
        shpP.Fill.Transparency     = 0
        shpP.Line.ForeColor.RGB    = RGB(20, 19, 35)
        shpP.Line.Weight           = IIf(isSel, 1.5, 0.5)
        With shpP.TextFrame
            .HorizontalAlignment = xlHAlignCenter
            .VerticalAlignment   = xlVAlignCenter
            .MarginTop = 0: .MarginBottom = 0
            .MarginLeft = 1: .MarginRight = 1
        End With
        With shpP.TextFrame.Characters
            .Text        = mes
            .Font.Size   = 8
            .Font.Bold   = isSel
            .Font.Color  = IIf(isSel, RGB(255, 255, 255), RGB(40, 38, 70))
        End With
        shpP.OnAction = "mdl_Inicio.ClickFilterPeriodo"
    Next i

    '--- ASSOCIAÇÃO (lado direito: G-H area) ---
    Dim aLbl(2) As String: aLbl(0) = "Todas": aLbl(1) = "Congonha": aLbl(2) = "Vaz Lobo"
    Dim aKey(2) As String: aKey(0) = "Todas": aKey(1) = "Congonha": aKey(2) = "VazLobo"
    Dim bWa As Double: bWa = 80
    Dim gA  As Double: gA  = 4
    Dim x0A As Double: x0A = ws.Columns("G").Left + 4

    For i = 0 To 2
        Dim isA As Boolean: isA = (aLbl(i) = m_FilterAssoc)
        Dim shpA As Shape
        Set shpA = ws.Shapes.AddShape(msoShapeRoundedRectangle, _
            x0A + i * (bWa + gA), bY, bWa, bH)
        shpA.Name = "FA_" & aKey(i)
        shpA.Fill.Solid
        shpA.Fill.ForeColor.RGB   = IIf(isA, RGB(8, 145, 178), RGB(208, 236, 243))
        shpA.Fill.Transparency    = 0
        shpA.Line.ForeColor.RGB   = RGB(8, 145, 178)
        shpA.Line.Weight          = IIf(isA, 1.5, 0.5)
        With shpA.TextFrame
            .HorizontalAlignment = xlHAlignCenter
            .VerticalAlignment   = xlVAlignCenter
            .MarginTop = 0: .MarginBottom = 0
            .MarginLeft = 2: .MarginRight = 2
        End With
        With shpA.TextFrame.Characters
            .Text        = aLbl(i)
            .Font.Size   = 8
            .Font.Bold   = isA
            .Font.Color  = IIf(isA, RGB(255, 255, 255), RGB(0, 80, 110))
        End With
        shpA.OnAction = "mdl_Inicio.ClickFilterAssoc"
    Next i
End Sub


'=============================================================================
' Bloco FINANCEIRO — col B (linhas 6-9)
'=============================================================================
Private Sub WriteFinanceiroBlock(ws As Worksheet, wsDados As Worksheet)
    Call DrawBlockHeader(ws, 6, 2, "FINANCEIRO", CLR_PRIMARY)

    Dim aF As String: aF = GetFilterAssocFull()

    Dim receita As Variant
    If aF = "" Then
        receita = GetScalar(wsDados, "RECEITA_MENSAL", "total_income", "month", m_FilterMes)
    Else
        receita = GetScalar2(wsDados, "RECEITA_MENSAL_ASSOC", "total_income", _
                             "month", m_FilterMes, "association_name", aF)
    End If
    Call DrawKpiRow(ws, 7, 2, "Receita Mês Atual", receita, "R$", CLR_LIGHT)

    Dim pg As Variant, pd As Variant, tx As Variant
    If aF = "" Then
        pg = GetScalar(wsDados, "INADIMPL_TOTAL", "pagas",    "", "")
        pd = GetScalar(wsDados, "INADIMPL_TOTAL", "pendentes","", "")
    Else
        pg = GetScalar(wsDados, "INADIMPLENCIA", "pagas",    "association_name", aF)
        pd = GetScalar(wsDados, "INADIMPLENCIA", "pendentes","association_name", aF)
    End If
    If Not IsEmpty(pg) And Not IsEmpty(pd) Then
        Dim tot As Double: tot = SafeD(pg) + SafeD(pd)
        If tot > 0 Then tx = Round(SafeD(pg) / tot * 100, 1)
    End If
    Call DrawKpiRow(ws, 8, 2, "Taxa de Cobrança", tx, "%", CLR_LIGHT)

    Dim rw As Variant
    If aF = "" Then
        rw = GetScalar(wsDados, "RUNWAY", "months_of_runway", "", "")
    Else
        rw = GetScalar(wsDados, "RUNWAY", "months_of_runway", "association_name", aF)
    End If
    Call DrawKpiRow(ws, 9, 2, "Runway Estimado", rw, "meses", CLR_LIGHT)
    Call DrawCardBorder(ws, 6, 2, 9, 3)
End Sub


'=============================================================================
' Bloco MENSALIDADES — col G (linhas 6-9)
'=============================================================================
Private Sub WriteMensalidadesBlock(ws As Worksheet, wsDados As Worksheet)
    Call DrawBlockHeader(ws, 6, 7, "MENSALIDADES", CLR_ACCENT)

    Dim aF As String: aF = GetFilterAssocFull()
    Dim pg As Variant, vc As Variant, ow As Variant

    If aF = "" Then
        pg = GetScalar(wsDados, "INADIMPL_TOTAL", "pagas",    "", "")
        vc = GetScalar(wsDados, "INADIMPL_TOTAL", "vencidas", "", "")
        ow = GetScalar(wsDados, "INADIMPL_TOTAL", "total_owed","", "")
    Else
        pg = GetScalar(wsDados, "INADIMPLENCIA", "pagas",    "association_name", aF)
        vc = GetScalar(wsDados, "INADIMPLENCIA", "vencidas", "association_name", aF)
        ow = GetScalar(wsDados, "INADIMPLENCIA", "total_owed","association_name", aF)
    End If

    Call DrawKpiRow(ws, 7, 7, "Mensalidades Pagas",    pg, "n",  CLR_LIGHT)
    Call DrawKpiRow(ws, 8, 7, "Mensalidades Vencidas", vc, "n",  CLR_LIGHT)
    Call DrawKpiRow(ws, 9, 7, "Valor Inadimplente",    ow, "R$", CLR_LIGHT)
    Call DrawCardBorder(ws, 6, 7, 9, 8)
End Sub


'=============================================================================
' Bloco MORADORES — col B (linhas 12-15)
'=============================================================================
Private Sub WriteMoradoresBlock(ws As Worksheet, wsDados As Worksheet)
    Call DrawBlockHeader(ws, 12, 2, "MORADORES", CLR_PRIMARY)

    Dim aF As String: aF = GetFilterAssocFull()
    Dim t As Variant, m As Variant, g As Variant

    If aF = "" Then
        t = GetScalar(wsDados, "MORADORES_TOTAL", "total",  "", "")
        m = GetScalar(wsDados, "MORADORES_TOTAL", "members","", "")
        g = GetScalar(wsDados, "MORADORES_TOTAL", "guests", "", "")
    Else
        t = GetScalar(wsDados, "MORADORES_GERAL", "total",  "association_name", aF)
        m = GetScalar(wsDados, "MORADORES_GERAL", "members","association_name", aF)
        g = GetScalar(wsDados, "MORADORES_GERAL", "guests", "association_name", aF)
    End If

    Call DrawKpiRow(ws, 13, 2, "Total de Moradores", t, "n", CLR_LIGHT)
    Call DrawKpiRow(ws, 14, 2, "Membros Ativos",     m, "n", CLR_LIGHT)
    Call DrawKpiRow(ws, 15, 2, "Visitantes",         g, "n", CLR_LIGHT)
    Call DrawCardBorder(ws, 12, 2, 15, 3)
End Sub


'=============================================================================
' Bloco PACOTES & OS — col G (linhas 12-15)
'=============================================================================
Private Sub WriteOperacoesBlock(ws As Worksheet, wsDados As Worksheet)
    Call DrawBlockHeader(ws, 12, 7, "PACOTES & OS", CLR_ACCENT)

    Dim stAF As String: stAF = GetFilterAssocFull()
    Dim st As Variant
    If stAF = "" Then
        st = GetScalar(wsDados, "PACOTES_STUCK", "total", "", "")
    Else
        st = GetScalar(wsDados, "PACOTES_STUCK", "total", "association_name", stAF)
    End If
    Dim os As Variant: os = GetScalar(wsDados, "KPI_OP",        "os_abertas",    "", "")
    Dim tf As Variant: tf = GetScalar(wsDados, "KPI_OP",        "tarefas_semana","", "")

    Call DrawKpiRow(ws, 13, 7, "Pacotes Parados +3d", st, "n", CLR_LIGHT)
    Call DrawKpiRow(ws, 14, 7, "OS Abertas",          os, "n", CLR_LIGHT)
    Call DrawKpiRow(ws, 15, 7, "Tarefas Semana",      tf, "n", CLR_LIGHT)
    Call DrawCardBorder(ws, 12, 7, 15, 8)
End Sub


'=============================================================================
' Alertas — linha 18+
'=============================================================================
Private Sub WriteAlertsBlock(ws As Worksheet, wsDados As Worksheet)
    Dim msgs(10) As String
    Dim nMsgs    As Integer: nMsgs = 0

    Dim aF2 As String: aF2 = GetFilterAssocFull()
    Dim stuck As Variant
    If aF2 = "" Then
        stuck = GetScalar(wsDados, "PACOTES_STUCK", "total", "", "")
    Else
        stuck = GetScalar(wsDados, "PACOTES_STUCK", "total", "association_name", aF2)
    End If
    If Not IsEmpty(stuck) And CLng(stuck) > 5 Then
        msgs(nMsgs) = ChrW(9888) & "  " & stuck & " pacotes parados há mais de 3 dias"
        nMsgs = nMsgs + 1
    End If

    Dim aF As String: aF = GetFilterAssocFull()
    Dim pg As Variant, pd As Variant
    If aF = "" Then
        pg = GetScalar(wsDados, "INADIMPL_TOTAL", "pagas",    "", "")
        pd = GetScalar(wsDados, "INADIMPL_TOTAL", "pendentes","", "")
    Else
        pg = GetScalar(wsDados, "INADIMPLENCIA", "pagas",    "association_name", aF)
        pd = GetScalar(wsDados, "INADIMPLENCIA", "pendentes","association_name", aF)
    End If
    If Not IsEmpty(pg) And Not IsEmpty(pd) Then
        Dim tot As Double: tot = SafeD(pg) + SafeD(pd)
        If tot > 0 Then
            Dim pct As Double: pct = SafeD(pg) / tot * 100
            If pct < 60 Then
                msgs(nMsgs) = ChrW(9888) & "  Taxa de cobrança abaixo de 60% (" & Format(pct, "0.0") & "%)"
                nMsgs = nMsgs + 1
            End If
        End If
    End If

    Dim hdrClr As Long: hdrClr = IIf(nMsgs > 0, CLR_RED, CLR_GREEN)
    With ws.Cells(18, 2)
        .Value = "  ALERTAS CRÍTICOS": .Font.Bold = True: .Font.Size = 9
        .Font.Color = CLR_WHITE: .Interior.Color = hdrClr
        .VerticalAlignment = xlCenter: .Font.Name = "Calibri"
    End With
    ws.Cells(18, 3).Interior.Color = hdrClr

    If nMsgs = 0 Then
        With ws.Cells(19, 2)
            .Value = "  " & ChrW(10003) & "  Sem alertas críticos"
            .Font.Color = CLR_GREEN: .Font.Size = 9: .Font.Name = "Calibri"
        End With
    Else
        Dim i As Integer
        For i = 0 To nMsgs - 1
            With ws.Cells(19 + i, 2)
                .Value = "  " & msgs(i)
                .Font.Color = CLR_RED: .Font.Size = 9: .Font.Name = "Calibri"
            End With
        Next i
    End If
End Sub


'=============================================================================
' Helpers de desenho
'=============================================================================

Private Sub DrawBlockHeader(ws As Worksheet, rowNum As Long, colNum As Long, _
                             title As String, bgColor As Long)
    With ws.Cells(rowNum, colNum)
        .Value = "  " & title: .Font.Bold = True: .Font.Size = 9
        .Font.Color = CLR_WHITE: .Interior.Color = bgColor
        .VerticalAlignment = xlCenter: .HorizontalAlignment = xlLeft
        .Font.Name = "Calibri"
    End With
    ws.Cells(rowNum, colNum + 1).Interior.Color = bgColor
End Sub


Private Sub DrawKpiRow(ws As Worksheet, rowNum As Long, colNum As Long, _
                        label As String, valor As Variant, fmt As String, bgColor As Long)
    With ws.Cells(rowNum, colNum)
        .Value = "  " & label: .Font.Size = 8: .Font.Color = CLR_GRAY
        .Interior.Color = bgColor: .VerticalAlignment = xlCenter
        .HorizontalAlignment = xlLeft: .Font.Name = "Calibri"
    End With

    Dim dv As String
    If IsEmpty(valor) Or IsNull(valor) Or CStr(valor) = "" Then
        dv = ChrW(8212)
    Else
        Select Case fmt
            Case "R$":    dv = "R$ " & Format(CDbl(valor), "#,##0.00")
            Case "%":     dv = Format(CDbl(valor), "0.0") & "%"
            Case "meses": dv = Format(CDbl(valor), "0.0") & " m"
            Case "n"
                If IsNumeric(valor) Then dv = Format(CLng(valor), "#,##0") Else dv = CStr(valor)
            Case Else:    dv = CStr(valor)
        End Select
    End If

    With ws.Cells(rowNum, colNum + 1)
        .Value = dv: .Font.Bold = True: .Font.Size = 13
        .Font.Color = CLR_PRIMARY: .Interior.Color = bgColor
        .HorizontalAlignment = xlRight: .VerticalAlignment = xlCenter
        .Font.Name = "Calibri"
    End With
End Sub


Private Sub DrawCardBorder(ws As Worksheet, r1 As Long, c1 As Long, _
                            r2 As Long, c2 As Long)
    Dim rng As Range: Set rng = ws.Range(ws.Cells(r1, c1), ws.Cells(r2, c2))
    Dim clr As Long: clr = RGB(180, 195, 210)
    With rng.Borders(xlEdgeTop)
        .LineStyle = xlContinuous: .Weight = xlThin: .Color = clr
    End With
    With rng.Borders(xlEdgeBottom)
        .LineStyle = xlContinuous: .Weight = xlThin: .Color = clr
    End With
    With rng.Borders(xlEdgeLeft)
        .LineStyle = xlContinuous: .Weight = xlThin: .Color = clr
    End With
    With rng.Borders(xlEdgeRight)
        .LineStyle = xlContinuous: .Weight = xlThin: .Color = clr
    End With
End Sub


'=============================================================================
' GetScalar — extrai valor de bloco nomeado em _DADOS
'=============================================================================
Public Function GetScalar(wsDados As Worksheet, rangeKey As String, _
                           colName As String, filterCol As String, filterVal As String) As Variant
    Dim rng As Range
    On Error Resume Next: Set rng = wsDados.Range("DL_" & rangeKey): On Error GoTo 0
    If rng Is Nothing Then GetScalar = Empty: Exit Function

    Dim hRow As Long: hRow = rng.Row - 1
    Dim ci As Integer: ci = 0
    Dim fi As Integer: fi = 0
    Dim c As Integer

    For c = 1 To 50
        Dim h As String: h = LCase(wsDados.Cells(hRow, c).Value)
        If h = LCase(colName)  Then ci = c
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


'=============================================================================
' GetScalar2 — dois filtros
'=============================================================================
Public Function GetScalar2(wsDados As Worksheet, rangeKey As String, _
                            colName As String, _
                            f1Col As String, f1Val As String, _
                            f2Col As String, f2Val As String) As Variant
    Dim rng As Range
    On Error Resume Next: Set rng = wsDados.Range("DL_" & rangeKey): On Error GoTo 0
    If rng Is Nothing Then GetScalar2 = Empty: Exit Function

    Dim hRow As Long: hRow = rng.Row - 1
    Dim ci As Integer: ci = 0
    Dim f1 As Integer: f1 = 0
    Dim f2 As Integer: f2 = 0
    Dim c As Integer

    For c = 1 To 50
        Dim h As String: h = LCase(wsDados.Cells(hRow, c).Value)
        If h = LCase(colName) Then ci = c
        If h = LCase(f1Col)   Then f1 = c
        If h = LCase(f2Col)   Then f2 = c
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


'=============================================================================
' SafeD
'=============================================================================
Public Function SafeD(v As Variant) As Double
    If IsEmpty(v) Or IsNull(v) Or Not IsNumeric(v) Then SafeD = 0 Else SafeD = CDbl(v)
End Function


'=============================================================================
' Helpers internos
'=============================================================================
Private Function GetFilterAssocFull() As String
    Select Case m_FilterAssoc
        Case "Congonha": GetFilterAssocFull = "Associação de Moradores de Congonha"
        Case "Vaz Lobo": GetFilterAssocFull = "Associação de Moradores de Vaz Lobo"
        Case Else:       GetFilterAssocFull = ""
    End Select
End Function

Private Function BuildMonthList(wsDados As Worksheet) As String
    Dim rng As Range
    On Error Resume Next: Set rng = wsDados.Range("DL_RECEITA_MENSAL"): On Error GoTo 0
    If rng Is Nothing Then BuildMonthList = Format(Now, "yyyy-mm"): Exit Function

    Dim parts(20) As String
    Dim n As Integer: n = 0
    Dim i As Long
    For i = rng.Row To rng.Row + rng.Rows.Count - 1
        Dim v As String: v = CStr(wsDados.Cells(i, 1).Value)
        If v Like "####-##" Then
            parts(n) = v: n = n + 1
            If n > 20 Then Exit For
        End If
    Next i
    If n = 0 Then BuildMonthList = Format(Now, "yyyy-mm"): Exit Function

    Dim res As String: Dim j As Integer
    For j = 0 To n - 1
        If j > 0 Then res = res & ","
        res = res & parts(j)
    Next j
    BuildMonthList = res
End Function
