Attribute VB_Name = "mdl_Main"
'=============================================================================
' APRXM Aproxima — Consolidado Executivo
' Associação de Moradores Sapê-Vaz Lobo e Buriti-Congonha
'
' Módulo: mdl_Main
' Responsabilidade: Ponto de entrada — popula todas as abas com os dados
'                   que já estão em _DADOS (carregados via mdl_DADOS)
'
' Fluxo de uso diário:
'   1. Abra o consolidado
'   2. No mdl_DADOS, descomente as 2 linhas de visibilidade da aba _DADOS
'   3. Execute RefreshAllData (Alt+F8)
'   4. Execute PopulateAll (Alt+F8) — ou deixe no Auto_Open
'   5. Recomente as linhas de visibilidade
'=============================================================================
Option Explicit

Public Sub PopulateAll()
    Dim t0 As Single: t0 = Timer

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    Application.EnableEvents = False

    On Error GoTo ErrHandler

    ' Verifica se _DADOS está disponível
    Dim wsDados As Worksheet
    On Error Resume Next
    Set wsDados = ThisWorkbook.Sheets("_DADOS")
    On Error GoTo ErrHandler

    If wsDados Is Nothing Then
        MsgBox "Aba _DADOS não encontrada." & vbCrLf & _
               "Execute primeiro RefreshAllData (mdl_DADOS) para carregar os dados.", _
               vbExclamation, "APRXM — Dados necessários"
        GoTo Cleanup
    End If

    ' Popula cada aba na ordem
    Application.StatusBar = "APRXM: populando INÍCIO..."
    mdl_Inicio.PopulateInicio

    Application.StatusBar = "APRXM: populando PRESIDÊNCIA..."
    mdl_Presidencia.PopulatePresidencia

    Application.StatusBar = "APRXM: populando FINANCEIRO..."
    mdl_Financeiro.PopulateFinanceiro

    Application.StatusBar = "APRXM: populando MORADORES..."
    mdl_Moradores.PopulateMoradores

    Application.StatusBar = "APRXM: populando MENSALIDADES..."
    mdl_Mensalidades.PopulateMensalidades

    Application.StatusBar = "APRXM: populando PACOTES..."
    mdl_Pacotes.PopulatePacotes

    Application.StatusBar = "APRXM: populando OS..."
    mdl_OS.PopulateOS

    Application.StatusBar = "APRXM: populando SENSO..."
    mdl_Senso.PopulateSenso

    ' Volta para aba INÍCIO
    ThisWorkbook.Sheets("INÍCIO").Activate

Cleanup:
    Application.ScreenUpdating = True
    Application.Calculation = xlCalculationAutomatic
    Application.EnableEvents = True
    Application.StatusBar = False

    MsgBox "Consolidado atualizado em " & Format(Timer - t0, "0.0") & "s" & vbCrLf & _
           Format(Now, "dd/mm/yyyy hh:mm"), vbInformation, "APRXM Aproxima"
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    Application.Calculation = xlCalculationAutomatic
    Application.EnableEvents = True
    Application.StatusBar = False
    MsgBox "Erro em PopulateAll: " & Err.Description & vbCrLf & _
           "Módulo: " & Erl, vbCritical, "APRXM — Erro"
End Sub


'=============================================================================
' Executado automaticamente ao abrir o workbook
' Apenas popula (não carrega dados do banco — isso é manual)
'=============================================================================
Public Sub Auto_Open()
    ' Se _DADOS existe e tem dados, popula as abas automaticamente
    Dim wsDados As Worksheet
    On Error Resume Next
    Set wsDados = ThisWorkbook.Sheets("_DADOS")
    On Error GoTo 0

    If wsDados Is Nothing Then Exit Sub

    ' Verifica se há dados carregados (célula B2 deve ter conteúdo)
    If Len(Trim(CStr(wsDados.Range("B2").Value))) > 0 Then
        PopulateAll
    End If
End Sub


'=============================================================================
' Cria a estrutura de abas do consolidado (rodar uma única vez na montagem)
'=============================================================================
Public Sub SetupWorkbook()
    Dim sheetNames As Variant
    sheetNames = Array("INÍCIO", "PRESIDÊNCIA", "FINANCEIRO", "MORADORES", _
                       "MENSALIDADES", "PACOTES", "OS", "SENSO")

    Dim i As Integer
    Dim ws As Worksheet

    ' Cria abas na ordem correta se não existirem
    For i = 0 To UBound(sheetNames)
        On Error Resume Next
        Set ws = ThisWorkbook.Sheets(sheetNames(i))
        On Error GoTo 0

        If ws Is Nothing Then
            Dim insertAfter As Worksheet
            Set insertAfter = ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count)
            Set ws = ThisWorkbook.Sheets.Add(After:=insertAfter)
            ws.Name = sheetNames(i)
        End If

        ' Formata aba
        FormatSheet ws, CStr(sheetNames(i))
        Set ws = Nothing
    Next i

    ' Cria aba _DADOS oculta
    Dim wsDados As Worksheet
    On Error Resume Next
    Set wsDados = ThisWorkbook.Sheets("_DADOS")
    On Error GoTo 0
    If wsDados Is Nothing Then
        Set wsDados = ThisWorkbook.Sheets.Add(After:=ThisWorkbook.Sheets(ThisWorkbook.Sheets.Count))
        wsDados.Name = "_DADOS"
    End If
    wsDados.Visible = xlSheetVeryHidden

    ' Instrução
    wsDados.Range("A1").Value = "Conexão Neon Analytics:"
    wsDados.Range("A1").Font.Bold = True
    wsDados.Range("B1").Value = "Driver={PostgreSQL Unicode};Server=ep-floral-shadow-ap9n86vs.c-7.us-east-1.aws.neon.tech;Port=5432;Database=neondb;Uid=neondb_owner;Pwd=npg_M2hLclCBG1XD;SSLmode=require;"
    wsDados.Range("A1").ColumnWidth = 25
    wsDados.Range("B1").ColumnWidth = 120

    MsgBox "Estrutura criada com sucesso!" & vbCrLf & _
           "Configure a connection string em _DADOS!B1 e execute RefreshAllData.", _
           vbInformation, "APRXM — Setup"
End Sub


Private Sub FormatSheet(ws As Worksheet, title As String)
    Const CLR_NAVY     As Long = 888337
    Const CLR_CERULEAN As Long = 11573706
    Const CLR_WHITE    As Long = 16777215

    With ws
        ' Fundo geral limpo
        .Cells.Interior.Color = 16777215  ' branco

        ' Linha de título (linha 1)
        .Rows(1).RowHeight = 40
        With .Range("A1:Z1")
            .Merge
            .Interior.Color = CLR_NAVY
        End With

        ' Nome da associação
        With .Range("A1")
            .Value = "Associação de Moradores Sapê-Vaz Lobo e Buriti-Congonha  |  APRXM Aproxima  |  " & title
            .Font.Color = CLR_WHITE
            .Font.Bold = True
            .Font.Size = 11
            .VerticalAlignment = xlCenter
            .WrapText = False
        End With

        ' Linha de sub-cabeçalho (linha 2)
        .Rows(2).RowHeight = 24
        With .Range("A2:Z2")
            .Merge
            .Interior.Color = CLR_CERULEAN
        End With
        With .Range("A2")
            .Value = "Consolidado Executivo  —  Dados do sistema APRXM Analytics  —  " & _
                     "Atualizado: " & Format(Now, "dd/mm/yyyy")
            .Font.Color = CLR_WHITE
            .Font.Size = 9
            .VerticalAlignment = xlCenter
        End With

        ' Named range para timestamp (atualizado pelo mdl_DADOS)
        On Error Resume Next
        ThisWorkbook.Names("TIMESTAMP_" & ws.Name).Delete
        On Error GoTo 0
        ThisWorkbook.Names.Add Name:="TIMESTAMP_" & ws.Name, RefersTo:=ws.Range("A2")

        ' Linhas de cabeçalho fixas (congelar painéis)
        .Range("B5").Select
        ActiveWindow.FreezePanes = True

        ' Tab color
        .Tab.Color = CLR_NAVY
        .DisplayGridlines = False
        .Zoom = 90
    End With
End Sub
