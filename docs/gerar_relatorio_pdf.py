# -*- coding: latin-1 -*-
"""Gerador de relatorio tecnico APRXM em PDF."""
from fpdf import FPDF

AZUL   = (26, 63, 111)
AZUL_L = (232, 240, 251)
VERDE  = (15, 122, 77)
VERM   = (220, 38, 38)
LARAN  = (194, 98, 10)
CINZA  = (75, 85, 99)
CINZAC = (243, 244, 246)
BRANCO = (255, 255, 255)
PRETO  = (17, 24, 39)

class PDF(FPDF):
    def header(self):
        self.set_fill_color(*AZUL)
        self.rect(0, 0, 210, 14, 'F')
        self.set_font('Helvetica', 'B', 9)
        self.set_text_color(*BRANCO)
        self.set_xy(10, 3)
        self.cell(0, 8, 'APRXM - Relatorio Tecnico  |  Instituto Tia Pretinha  |  Abr-Jun 2026', align='L')
        self.set_xy(10, 3)
        self.cell(0, 8, 'Pag. ' + str(self.page_no()), align='R')
        self.ln(10)

    def footer(self):
        self.set_y(-10)
        self.set_font('Helvetica', '', 7)
        self.set_text_color(*CINZA)
        self.cell(0, 8, 'Gerado em 02/06/2026  |  Claude Sonnet 4.6  |  APRXM v1.0.0', align='C')

    def titulo(self, texto, cor=AZUL):
        self.set_fill_color(*cor)
        self.set_text_color(*BRANCO)
        self.set_font('Helvetica', 'B', 11)
        self.cell(0, 8, '  ' + texto, fill=True, ln=True)
        self.ln(2)
        self.set_text_color(*PRETO)

    def sub(self, texto):
        self.set_font('Helvetica', 'B', 9)
        self.set_text_color(*AZUL)
        self.cell(0, 6, texto, ln=True)
        self.set_text_color(*PRETO)

    def item(self, texto):
        self.set_font('Helvetica', '', 8.5)
        self.set_x(16)
        self.cell(2, 5, '-')
        self.set_x(19)
        self.multi_cell(181, 5, texto)

    def tbl(self, headers, rows, widths=None, hcor=AZUL):
        if widths is None:
            w = (self.w - 20) / len(headers)
            widths = [w] * len(headers)
        self.set_fill_color(*hcor)
        self.set_text_color(*BRANCO)
        self.set_font('Helvetica', 'B', 7.5)
        self.set_x(10)
        for h, w in zip(headers, widths):
            self.cell(w, 6, ' ' + h, fill=True, border=0)
        self.ln()
        self.set_text_color(*PRETO)
        for i, row in enumerate(rows):
            self.set_fill_color(*(CINZAC if i % 2 == 0 else BRANCO))
            self.set_font('Helvetica', '', 7.5)
            self.set_x(10)
            for cell, w in zip(row, widths):
                self.cell(w, 5.5, ' ' + str(cell), fill=True, border=0)
            self.ln()
        self.ln(2)

    def kpis(self, items):
        w = (self.w - 20) / len(items)
        self.set_x(10)
        for label, valor, cor in items:
            self.set_fill_color(*cor)
            x, y = self.get_x(), self.get_y()
            self.rect(x, y, w - 2, 18, 'F')
            self.set_xy(x + 2, y + 1)
            self.set_font('Helvetica', '', 7)
            self.set_text_color(*BRANCO)
            self.cell(w - 4, 5, label, ln=True)
            self.set_xy(x + 2, y + 6)
            self.set_font('Helvetica', 'B', 13)
            self.cell(w - 4, 9, str(valor))
            self.set_xy(x + w, y)
        self.ln(20)
        self.set_text_color(*PRETO)


pdf = PDF(orientation='P', unit='mm', format='A4')
pdf.set_auto_page_break(auto=True, margin=14)
pdf.set_margins(10, 16, 10)
pdf.add_page()

# CAPA
pdf.set_fill_color(*AZUL)
pdf.rect(0, 0, 210, 58, 'F')
pdf.set_font('Helvetica', 'B', 22)
pdf.set_text_color(*BRANCO)
pdf.set_xy(10, 14)
pdf.cell(0, 12, 'Relatorio Tecnico - APRXM', ln=True)
pdf.set_font('Helvetica', '', 12)
pdf.set_x(10)
pdf.cell(0, 7, 'Instituto Tia Pretinha  |  Abril - Junho 2026', ln=True)
pdf.set_font('Helvetica', '', 9)
pdf.set_x(10)
pdf.cell(0, 6, 'FastAPI | React 18 | Neon PostgreSQL | Cloudflare R2 | Vercel', ln=True)
pdf.set_text_color(*PRETO)
pdf.ln(6)

# KPIs gerais
pdf.kpis([
    ('Commits', '50', AZUL),
    ('Features', '80+', VERDE),
    ('Bugs corrigidos', '17+', VERM),
    ('CVEs resolvidos', '12+', LARAN),
    ('Endpoints', '25+', (107, 33, 168)),
    ('Linhas de codigo', '~15k', CINZA),
])

# 1. FINANCEIRO
pdf.titulo('1.  Modulo Financeiro')
pdf.sub('Features')
for f in [
    'FinanceiroPage - refatoracao de 3.920 linhas em abas independentes com contexto global',
    'send_to_malote - router + service layer para transferencia ao malote',
    'Conferencia de caixa - multiplos relatorios, atribuicao de quebras por associacao',
    'Descritores padronizados: "Mensalidade Mai/2026 - Nome" em todas as transacoes',
    'GeralPage modo Escritorio - detecta isOffice no JWT',
    'Alterar vencimento mensalidade - atualiza perfil + cobrancas pendentes',
    'Inventario financeiro - saldo esperado vs contado com justificativa obrigatoria',
]:
    pdf.item(f)
pdf.ln(2)
pdf.sub('Bugs Corrigidos')
pdf.tbl(['Bug', 'Impacto', 'Causa Raiz'], [
    ['is_cofre=false nos cofres',       'Saldo zerado no sistema',        'Flag incorreta no banco'],
    ['Float em sangrias',               'Arredondamento monetario errado', 'float -> Decimal'],
    ['reopen sem closed_by',            'Constraint violation',            'Campo omitido no UPDATE'],
    ['total_expense nao calculado',     'Saldo caixa errado p/ operadores','Soma omitida na query de sessao'],
    ['Lancamento nao quitava mensalid.','Divida ativa apos pagamento',     'UPDATE status=paid faltando'],
    ['Inventario c/ sessoes abertas',   'Estado inconsistente',            'Sem verificacao previa'],
    ['KPI delinquentes inflado',        'Metricas incorretas',             'Filtro income_subtype faltando'],
], widths=[60, 60, 70])

# 2. MORADORES
pdf.titulo('2.  Modulo de Moradores')
pdf.sub('Features')
for f in [
    'Tipo Dependente - novo enum + model + CRUD completo',
    '/residents/kpis - total, sem_cep, sem_telefone, sem_cpf, inadimplentes via COUNT SQL',
    'Merge de moradores - consolidacao de cadastros duplicados',
    '/residents/search com parametro street',
    'Paginacao de 50 por pagina - limit/offset + botao Carregar mais',
    'Normalizacao de ruas: _normalize_street() - strip + title case',
]:
    pdf.item(f)
pdf.ln(2)
pdf.sub('Bugs Corrigidos')
pdf.tbl(['Bug', 'Impacto', 'Causa Raiz'], [
    ['Badge "Visitantes 200" c/ 706 reais', 'Dados errados p/ gestores',    'data.length limitado pela paginacao'],
    ['Logradouro sem campo no form',        'Rua nao exibida apos CEP',      'State setado sem input no JSX'],
    ['Lookup CEP direto (CORS/timeout)',    'Erro em mobile/corporativo',    'Proxy backend + fallback BrasilAPI'],
    ['Dropdown cortado (overflow-hidden)',  'Inacessivel em mobile',         'Container pai sem overflow visible'],
    ['migration_payments na inadimplencia','Contagem inflada em 26 reg.',    'NOT EXISTS adicionado'],
], widths=[62, 60, 68])

# 3. ENCOMENDAS
pdf.titulo('3.  Modulo de Encomendas')
pdf.sub('Features')
for f in [
    '/packages/by-address - encomendas agrupadas por rua/CEP',
    '4 KPI cards clicaveis - filtro in-place por status (Aguardando/Recebido/Entregue)',
    'Banner de inadimplencia antes de entregar - alerta visual',
    '/packages/{id}/delivery-check - is_delinquent, fee_will_apply',
    'Paginacao de 50 + botao Carregar mais',
]:
    pdf.item(f)
pdf.ln(2)
pdf.sub('Bugs Corrigidos')
pdf.tbl(['Bug', 'Impacto', 'Causa Raiz'], [
    ['Filtro de data removendo historico', 'Auditor sem visibilidade',      'date_from sempre aplicado'],
    ['Input de data desmontando',          'Impossivel inserir datas',      'DateRange dentro de FilterPanel - React recriava'],
    ['Caracteres controle no Excel',       'Download falhava',              'Regex _ILLEGAL p/ ASCII 0x00-0x1F'],
    ['Status "Recebido" confuso',          'Fluxo operacional errado',      'Renomeado p/ "Na portaria (nao notif.)"'],
], widths=[62, 60, 68])

# 4. TAREFAS DIARIAS
pdf.titulo('4.  Modulo de Tarefas Diarias')
pdf.sub('Features')
for f in [
    'Modulo completo - CRUD, checklist por item, comentarios com fotos',
    'PDF por colaborador - GET /daily-tasks/report/pdf via fpdf2',
    'Acompanhamento por item - comentarios vinculados a checklist_index',
    'Tarefas concluidas somem imediatamente ao marcar (sem reload)',
    'Ordenacao por Abertura (created_at) na barra de sort',
]:
    pdf.item(f)
pdf.ln(2)
pdf.sub('Bugs Corrigidos')
pdf.tbl(['Bug', 'Impacto', 'Causa Raiz'], [
    ['create_notification s/ try/except',  '500 ao atribuir tarefa',        'Exception sem tratamento'],
    ['State global de comentarios/fotos',  'Dados misturados entre tarefas','commentInput global em vez de por taskId'],
    ['Date binding asyncpg',               'Tarefas nao criadas - 500',     'String em vez de date.fromisoformat()'],
    ['Checklist c/ association_id errado', 'UPDATE silencioso',             'Filtrava Congonha / tarefas em VL'],
    ['Cache comentarios nunca invalidado', 'Novos comentarios invisiveis',  'if (comments[taskId]) return bloqueava'],
    ['PDF em branco',                      'Relatorio sem conteudo',        'JOIN c/ usuario deletado nao retornava'],
    ['Edit com lentidao',                  'UX degradada ao clicar Editar', '11 setState -> startTransition + useMemo'],
], widths=[58, 58, 74])

# 5. ORDENS DE SERVICO
pdf.titulo('5.  Ordens de Servico & Demandas')
pdf.sub('Bugs Corrigidos')
pdf.tbl(['Bug', 'Impacto', 'Causa Raiz'], [
    ['_get sem association_ids',          'Leak de tenant entre associacoes','Filtro multi-tenant omitido em 4 lugares'],
    ["Enum 'resolved' vs 'concluido'",    'Status nao atualizava no banco',  'Frontend enviava string errada'],
    ['RequireModule bloqueando rota',     'Pagina inacessivel p/ roles',     'Guard removido; controle interno'],
], widths=[58, 62, 70])

# 6. RELATORIOS
pdf.titulo('6.  Modulo de Relatorios - Redesign')
for f in [
    'Quick Reports: 3 cards no topo com seletor de periodo e download direto (sem preview)',
    '  > Inadimplentes  /  Moradores Ativos  /  Financeiro do Periodo',
    'Progressive disclosure: filtros essenciais visiveis + "+ Mais filtros (N)" p/ avancados',
    'Renomeacao: "Entregas" -> "Produtividade da Equipe"  |  "Mensalidades" -> "Mensalidades/Inadimplencia"',
    'Aba Produtividade - relatorio por colaborador: tarefas, OS, demandas',
]:
    pdf.item(f)
pdf.ln(3)

# 7. SIMPLIFICA
pdf.titulo('7.  Modo Simplifica (Mobile-first)')
pdf.sub('Bugs Corrigidos')
pdf.tbl(['Bug', 'Causa Raiz'], [
    ['gridAutoRows global quebrava sub-paginas',  'Seletor CSS sem escopo - corrigido para menu principal'],
    ['iOS Safari - teclado redimensionava chat',  'window.innerHeight ignorava teclado -> VisualViewport API'],
    ['Chat colapsava em algumas telas',           'Container sem min-height: 0 em flex column'],
    ['Mapa divIcon invalido',                     'divIcon recriando no DOM fora do ciclo React'],
], widths=[80, 110])

# 8. PAINEL DE TI
pdf.titulo('8.  Painel de TI')
for f in [
    'TIPage completa com 5 abas: Performance, Banco, Endpoints, Arquitetura, Analytics',
    'Middleware de performance - request_perf registra tempo medio, P95, erros por endpoint',
    'Governanca do ETL - inventario R2, pipeline visual, historico de execucoes, alertas',
    'Diagrama SVG da arquitetura gerado em codigo (sem imagem externa)',
    'Analytics DB - 18 tabelas Gold, dominios, conexao Power BI',
]:
    pdf.item(f)
pdf.ln(3)

# 9. DATA LAKE
pdf.titulo('9.  Data Lake & ETL - Arquitetura Medallion')
pdf.set_fill_color(*AZUL_L)
pdf.set_font('Helvetica', 'B', 8.5)
pdf.set_x(10)
pdf.cell(190, 7, '  Neon OLTP  ->  Bronze (R2 Parquet)  ->  Silver (pandas)  ->  Gold (R2 + Neon Analytics)  ->  Power BI', fill=True, ln=True)
pdf.ln(2)
pdf.sub('Features')
for f in [
    'Incremental extract - delta WHERE updated_at > last_extracted_at  |  98% menos dados vs full',
    '11 tabelas Bronze  |  5 datasets Silver (zero queries ao banco)  |  18 tabelas Gold em 5 dominios',
    'ETL 2x/dia: 09h e 17h Brasilia  |  etl_runs + etl_task_runs para auditoria completa',
    'Alerta e-mail automatico em falhas  |  disparo manual via POST /datalake/run/manual',
    'Neon Analytics OLAP (aprxm-analytics) - 18 tabelas carregadas com df.to_sql',
]:
    pdf.item(f)
pdf.ln(2)
pdf.sub('Correcoes de Qualidade de Dados')
pdf.tbl(['Problema', 'Fix'], [
    ['UUID asyncpg quebrava PyArrow',           'hasattr(sample, "hex") -> str()'],
    ['Timezone mismatch (UTC vs naive)',         'Helper _to_dt() garante tz-naive'],
    ['delinquency_report com dependentes',       'type="member" AND status="active"'],
    ['operator_performance com zeros',           'Bronze direto (Silver perdia received_by)'],
    ['associados_ativos = 919 (correto: 155)',   'Filtrado para type="member"'],
    ['Runway R$1.170/sem (correto: R$35)',        'Sangrias "Repasse caixinha" excluidas'],
    ['Ruas duplicadas no censo',                 '_normalize_street(): strip + title case'],
], widths=[100, 90])

# 10. POWER BI
pdf.titulo('10.  Dashboard Power BI - Modelo Semantico')
pdf.tbl(['Componente', 'Detalhe'], [
    ['Tabelas',         '20 (18 Gold + dim_Calendario + _Medidas oculta)'],
    ['Medidas DAX',     '22 em 5 display folders (Financeiro, Moradores, Encomendas, Operacional, Equipe)'],
    ['Relacionamentos', '8 fato -> dim_Calendario'],
    ['Roles RLS',       'diretoria | admin | operacional'],
    ['Fonte de dados',  'Neon Analytics via Import Mode (psycopg2)'],
    ['Taxonomia',       'Prefixo fato_ | colunas snake_case PT | medidas Title Case PT'],
], widths=[48, 142])

pdf.sub('Auditoria de Qualidade')
pdf.tbl(['Anomalia', 'Status'], [
    ['Dependent em delinquency_report',  'Resolvido - filtro type=member'],
    ['KPI vs delinquency gap',           'Resolvido - 0 diferenca'],
    ['operator_performance zeros',       'Resolvido - Bronze direto'],
    ['sla_by_type tempo=0 (historico)',  'Residual - DAX ja trata'],
    ['Runway Congonha NULL',             'Dado ausente - modulo de caixa nao utilizado'],
], widths=[100, 90])

# 11. SEGURANCA
pdf.titulo('11.  Seguranca')
pdf.tbl(['CVE / Melhoria', 'Severidade', 'Acao'], [
    ['starlette - ReDoS',               'Critical',   'Atualizado para versao corrigida'],
    ['urllib3 - request smuggling',     'High',       'Atualizado'],
    ['pyjwt - algorithm confusion',     'High',       'Atualizado'],
    ['cryptography - multiplas CVEs',   'High',       'Atualizado'],
    ['Rate limiting login',             'Melhoria',   'slowapi: 10 req/min'],
    ['CSP headers',                     'Melhoria',   'Middleware FastAPI'],
    ['Refresh token',                   'Melhoria',   'Expiracao 7 dias'],
], widths=[78, 28, 84])

# 12. BUGS CRITICOS RANKING
pdf.titulo('12.  Ranking de Bugs por Severidade', cor=VERM)
pdf.set_fill_color(*VERM)
pdf.set_text_color(*BRANCO)
pdf.set_font('Helvetica', 'B', 8)
pdf.set_x(10)
pdf.cell(190, 6, '  CRITICOS - Afetavam fluxo principal em producao', fill=True, ln=True)
pdf.set_text_color(*PRETO)
pdf.tbl(['#', 'Modulo', 'Bug'], [
    ['1', 'Tarefas',    'create_notification sem try/except -> 500 ao atribuir tarefa'],
    ['2', 'Financeiro', 'Lancamento offline nao quitava mensalidade'],
    ['3', 'Tarefas',    'State global de comentarios - dados misturados entre tarefas'],
    ['4', 'Tarefas',    'Checklist com association_id errado - UPDATE silencioso'],
    ['5', 'Financeiro', 'total_expense nao calculado - saldo do caixa errado p/ todos'],
    ['6', 'OS',         'Sem filtro association_ids - leak de tenant entre associacoes'],
    ['7', 'Financeiro', 'Float em sangrias - arredondamento monetario incorreto'],
], widths=[8, 28, 154])

pdf.set_fill_color(*LARAN)
pdf.set_text_color(*BRANCO)
pdf.set_font('Helvetica', 'B', 8)
pdf.set_x(10)
pdf.cell(190, 6, '  ALTOS - Degradavam UX significativamente', fill=True, ln=True)
pdf.set_text_color(*PRETO)
pdf.tbl(['#', 'Modulo', 'Bug'], [
    ['8',  'Encomendas', 'Input de data desmontando ao digitar - impossivel usar filtros'],
    ['9',  'Tarefas',    'Edit com lentidao - 11 setState sem startTransition'],
    ['10', 'CEP',        'Lookup direto causava CORS/timeout em mobile'],
    ['11', 'Relatorios', 'Caracteres de controle quebravam download Excel'],
    ['12', 'Tarefas',    'PDF em branco para usuarios deletados'],
], widths=[8, 28, 154])

# 13. PENDENCIAS
pdf.titulo('13.  Pendencias em Aberto', cor=CINZA)
pdf.tbl(['Item', 'Status'], [
    ['Injecao de visuais no .pbix via Python', 'BLOQUEADO - PBI 2.154 com validacoes ZIP incompativeis'],
    ['9 paginas do dashboard PBI',             'EM PROGRESSO - construcao manual no Power BI Desktop'],
    ['21 moradores com ruas incorretas',       'AGUARDANDO - correcao manual pelo admin'],
    ['Runway Congonha NULL',                   'DADO AUSENTE - modulo de caixa nao utilizado'],
], widths=[85, 105])

out = r'C:\Users\gonca\Documents\APRXM_Relatorio_Tecnico_Jun2026.pdf'
pdf.output(out)
print('PDF gerado: ' + out)

