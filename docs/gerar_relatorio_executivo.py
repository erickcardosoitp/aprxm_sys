# -*- coding: latin-1 -*-
"""Relatorio executivo APRXM - versao para leigos."""
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
AMARELO= (251, 191, 36)

class PDF(FPDF):
    def header(self):
        self.set_fill_color(*AZUL)
        self.rect(0, 0, 210, 12, 'F')
        self.set_font('Helvetica', 'B', 8)
        self.set_text_color(*BRANCO)
        self.set_xy(10, 2)
        self.cell(0, 8, 'APRXM - Sistema de Gestao  |  Instituto Tia Pretinha', align='L')
        self.set_xy(10, 2)
        self.cell(0, 8, 'Pag. ' + str(self.page_no()), align='R')
        self.ln(8)

    def footer(self):
        self.set_y(-10)
        self.set_font('Helvetica', '', 7)
        self.set_text_color(*CINZA)
        self.cell(0, 8, 'Relatorio de Evolucao do Sistema - Abril a Junho de 2026', align='C')

    def secao(self, icone, titulo, cor=AZUL):
        self.ln(2)
        self.set_fill_color(*cor)
        self.set_text_color(*BRANCO)
        self.set_font('Helvetica', 'B', 11)
        self.set_x(10)
        self.cell(190, 9, '  ' + icone + '  ' + titulo, fill=True, ln=True)
        self.ln(2)
        self.set_text_color(*PRETO)

    def subsecao(self, texto, cor=AZUL):
        self.set_font('Helvetica', 'B', 8.5)
        self.set_text_color(*cor)
        self.set_x(10)
        self.cell(0, 6, texto, ln=True)
        self.set_text_color(*PRETO)

    def item_ok(self, texto):
        self.set_font('Helvetica', '', 8.5)
        self.set_text_color(15, 122, 77)
        self.set_x(14)
        self.cell(5, 5, '[+]')
        self.set_text_color(*PRETO)
        self.set_x(20)
        self.multi_cell(180, 5, texto)

    def item_fix(self, texto):
        self.set_font('Helvetica', '', 8.5)
        self.set_text_color(220, 38, 38)
        self.set_x(14)
        self.cell(5, 5, '[!]')
        self.set_text_color(*PRETO)
        self.set_x(20)
        self.multi_cell(180, 5, texto)

    def tabela_simples(self, col1, col2, linhas, w1=95, w2=95):
        self.set_fill_color(*AZUL)
        self.set_text_color(*BRANCO)
        self.set_font('Helvetica', 'B', 8)
        self.set_x(10)
        self.cell(w1, 6, '  ' + col1, fill=True, border=0)
        self.cell(w2, 6, '  ' + col2, fill=True, border=0)
        self.ln()
        self.set_text_color(*PRETO)
        for i, (a, b) in enumerate(linhas):
            self.set_fill_color(*(CINZAC if i % 2 == 0 else BRANCO))
            self.set_font('Helvetica', '', 8)
            self.set_x(10)
            self.cell(w1, 5.5, '  ' + a, fill=True, border=0)
            self.cell(w2, 5.5, '  ' + b, fill=True, border=0)
            self.ln()
        self.ln(3)

    def kpi_card(self, items):
        w = 190 / len(items)
        self.set_x(10)
        for label, val, sub, cor in items:
            x, y = self.get_x(), self.get_y()
            self.set_fill_color(*cor)
            self.rect(x, y, w - 1, 22, 'F')
            self.set_xy(x + 2, y + 1.5)
            self.set_font('Helvetica', 'B', 16)
            self.set_text_color(*BRANCO)
            self.cell(w - 4, 9, val)
            self.set_xy(x + 2, y + 10)
            self.set_font('Helvetica', 'B', 7.5)
            self.cell(w - 4, 5, label, ln=True)
            self.set_xy(x + 2, y + 15)
            self.set_font('Helvetica', '', 7)
            self.cell(w - 4, 5, sub)
            self.set_xy(x + w, y)
        self.ln(25)
        self.set_text_color(*PRETO)

    def destaque(self, texto, cor=AZUL_L, texto_cor=AZUL):
        self.set_fill_color(*cor)
        self.set_font('Helvetica', 'B', 8.5)
        self.set_text_color(*texto_cor)
        self.set_x(10)
        self.multi_cell(190, 6, '  ' + texto, fill=True)
        self.ln(1)
        self.set_text_color(*PRETO)


# ════════════════════════════════════════════════════════════════════════════
pdf = PDF(orientation='P', unit='mm', format='A4')
pdf.set_auto_page_break(auto=True, margin=14)
pdf.set_margins(10, 14, 10)
pdf.add_page()

# ── CAPA ────────────────────────────────────────────────────────────────────
pdf.set_fill_color(*AZUL)
pdf.rect(0, 0, 210, 65, 'F')
pdf.set_font('Helvetica', 'B', 26)
pdf.set_text_color(*BRANCO)
pdf.set_xy(10, 14)
pdf.cell(0, 13, 'APRXM - Sistema de Gestao', ln=True)
pdf.set_font('Helvetica', 'B', 14)
pdf.set_x(10)
pdf.cell(0, 8, 'Relatorio de Evolucao e Melhorias', ln=True)
pdf.set_font('Helvetica', '', 10)
pdf.set_x(10)
pdf.cell(0, 7, 'Instituto Tia Pretinha  |  Abril a Junho de 2026', ln=True)
pdf.set_text_color(*PRETO)
pdf.ln(10)

# ── RESUMO ──────────────────────────────────────────────────────────────────
pdf.destaque(
    'Este relatorio apresenta tudo que foi desenvolvido, melhorado e corrigido no '
    'sistema APRXM nos ultimos dois meses. O objetivo e mostrar de forma clara '
    'o valor entregue para as duas associacoes: Vaz Lobo e Congonha.',
    cor=AZUL_L, texto_cor=AZUL
)
pdf.ln(2)

pdf.kpi_card([
    ('Funcionalidades novas',   '80+',  'em todos os modulos',  AZUL),
    ('Problemas corrigidos',    '17+',  'bugs criticos',         VERM),
    ('Melhorias de desempenho', '15+',  'mais rapido e estavel', VERDE),
    ('Vulnerabilidades seguras','12',   'sistema protegido',     LARAN),
])

# ── 1. O QUE FOI FEITO ───────────────────────────────────────────────────────
pdf.secao('>', 'O que foi feito de novo no sistema')

pdf.subsecao('Financeiro e Caixa')
pdf.item_ok('Redesign completo da pagina financeira - ficou mais organizada e facil de navegar')
pdf.item_ok('Transferencia para o malote: agora o operador pode enviar valores direto para o malote pelo sistema')
pdf.item_ok('Conferencia de caixa melhorada: o sistema agora gera relatorios completos e exige justificativa quando ha diferenca no dinheiro')
pdf.item_ok('Alterar dia de vencimento da mensalidade: a associacao pode mudar o dia de cobranca de cada morador')
pdf.item_ok('Inventario financeiro: controle de quanto dinheiro o cofre deveria ter vs o que realmente tem')
pdf.ln(2)

pdf.subsecao('Moradores')
pdf.item_ok('Novo tipo de morador: Dependente (filho, conjuge) - antes so havia Associado e Visitante')
pdf.item_ok('Unificacao de cadastros duplicados: quando o mesmo morador esta cadastrado duas vezes, o sistema agora permite juntar os dois em um so')
pdf.item_ok('Relatorio de inadimplentes por rua: agora e possivel ver quem esta devendo agrupado por rua')
pdf.item_ok('Paginacao na lista de moradores: o sistema carrega 50 de cada vez em vez de todos de uma vez, ficando mais rapido')
pdf.ln(2)

pdf.subsecao('Encomendas')
pdf.item_ok('Agrupamento por rua: visao de todas as encomendas pendentes organizadas por rua para facilitar a entrega')
pdf.item_ok('Alerta de inadimplencia: ao registrar entrega, o sistema avisa se o morador esta devendo')
pdf.item_ok('Indicadores no topo da pagina: numeros clicaveis de encomendas aguardando, entregues, devolvidas')
pdf.ln(2)

pdf.subsecao('Tarefas Diarias')
pdf.item_ok('Modulo completo de tarefas diarias: criar, atribuir, acompanhar e fechar tarefas da equipe')
pdf.item_ok('Checklist por tarefa: cada tarefa pode ter uma lista de itens a verificar, com fotos e comentarios por item')
pdf.item_ok('Relatorio PDF por colaborador: gera um relatorio de produtividade de cada membro da equipe')
pdf.item_ok('Tarefas concluidas sumem automaticamente da lista, deixando so o que ainda precisa ser feito')
pdf.ln(2)

pdf.subsecao('Relatorios')
pdf.item_ok('Acesso rapido: 3 botoes no topo para os relatorios mais pedidos - Inadimplentes, Moradores Ativos e Financeiro - basta clicar e baixar')
pdf.item_ok('Filtros simplificados: os filtros mais usados aparecem na frente; os avancados ficam escondidos ate precisar')
pdf.item_ok('Nomes mais claros: "Entregas" virou "Produtividade da Equipe"; "Mensalidades" ficou "Mensalidades / Inadimplencia"')
pdf.ln(2)

pdf.subsecao('App para Celular (Modo Simplifica)')
pdf.item_ok('Nova tela de tarefas diarias no celular - design simples para uso rapido em campo')
pdf.item_ok('Mapa de moradores: visualizacao no mapa de onde os moradores moram')
pdf.item_ok('Layout de tela cheia no celular: os tiles agora ocupam toda a tela sem espaco desperdicado')
pdf.ln(2)

pdf.subsecao('Painel de TI e Monitoramento')
pdf.item_ok('Novo painel de TI completo: velocidade dos endpoints, tamanho do banco, historico de execucao do pipeline de dados')
pdf.item_ok('Diagrama do sistema: mapa visual de toda a arquitetura do APRXM')
pdf.ln(2)

pdf.subsecao('Dados e Relatorios Avancados (Data Lake)')
pdf.item_ok('Pipeline de dados automatico: todo dia as 9h e 17h o sistema extrai, trata e organiza os dados em camadas')
pdf.item_ok('18 relatorios analiticos gerados automaticamente: receita diaria, inadimplencia, desempenho de operadores, SLA de encomendas e mais')
pdf.item_ok('Dashboard Power BI conectado: painel gerencial com graficos e indicadores para a diretoria')
pdf.item_ok('Economia de 98% na transferencia de dados: o sistema so busca o que mudou desde a ultima execucao')

# ── 2. PROBLEMAS CORRIGIDOS ───────────────────────────────────────────────────
pdf.secao('!', 'Problemas que foram corrigidos', cor=VERM)

pdf.destaque(
    'Abaixo estao os principais problemas que foram identificados e corrigidos. '
    'Os mais graves sao os que afetavam o uso diario do sistema.',
    cor=(255, 235, 235), texto_cor=VERM
)
pdf.ln(2)

pdf.subsecao('Problemas graves (que travavam o sistema ou causavam dados errados)')
problemas_graves = [
    ('Caixa nao fechava corretamente',
     'Ao tentar reabrir uma sessao de caixa, o sistema travava com erro. Corrigido.'),
    ('Pagamento registrado mas divida nao baixava',
     'Quando o operador lancava um pagamento avulso, o sistema marcava como pago mas a mensalidade continuava "em aberto". Corrigido.'),
    ('Comentario de uma tarefa aparecia em outra',
     'Um bug fazia com que o comentario digitado em uma tarefa aparecesse em outra tarefa. Corrigido.'),
    ('Atualizar checklist nao salvava',
     'Ao marcar itens do checklist em tarefas de Vaz Lobo usando o login da Congonha, as alteracoes nao eram salvas. Corrigido.'),
    ('Saldo do caixa aparecia errado',
     'O valor de saidas nao estava sendo calculado, fazendo o saldo aparecer maior do que realmente era. Corrigido.'),
    ('Dados de uma associacao visiveis para outra',
     'Um erro de seguranca permitia que ordens de servico de Vaz Lobo aparecessem para operadores de Congonha. Corrigido.'),
    ('Arredondamento errado em valores financeiros',
     'Calculos com centavos podiam gerar diferenças de R$0,01 a R$0,02. Corrigido com tipo de dado correto.'),
]
for prob, sol in problemas_graves:
    pdf.set_font('Helvetica', 'B', 8.5)
    pdf.set_text_color(*VERM)
    pdf.set_x(14)
    pdf.cell(0, 5, '>> ' + prob, ln=True)
    pdf.set_font('Helvetica', '', 8.5)
    pdf.set_text_color(*PRETO)
    pdf.set_x(20)
    pdf.multi_cell(180, 5, sol)
    pdf.ln(1)

pdf.ln(2)
pdf.subsecao('Problemas que atrapalhavam o uso diario')
problemas_medios = [
    ('Nao conseguia digitar a data nos filtros de encomendas',
     'O campo de data se "reiniciava" a cada letra digitada. Corrigido.'),
    ('Tela do chat encolhia ao abrir teclado no iPhone',
     'No iOS, ao abrir o teclado, a tela ficava pequena. Corrigido.'),
    ('CEP nao preenchia o endereco automaticamente',
     'Em celulares corporativos e conexoes de empresa, a busca de CEP falhava. Agora passa pelo servidor, sem falha.'),
    ('Download de relatorio Excel falhava',
     'Alguns relatorios tinham caracteres especiais que corrompiam o arquivo Excel. Corrigido.'),
    ('Editar uma tarefa era lento',
     'Clicar em "Editar" demorava por causa de atualizacoes desnecessarias na tela. Corrigido, agora e instantaneo.'),
    ('Contador de visitantes mostrava 200 em vez de 706',
     'O numero na aba de Visitantes era cortado por um limite tecnico. Corrigido para mostrar o numero real.'),
    ('Rua nao aparecia no cadastro de visitante',
     'Ao buscar o CEP no cadastro de visitante, o campo de rua nao era preenchido. Corrigido.'),
]
for prob, sol in problemas_medios:
    pdf.set_font('Helvetica', 'B', 8.5)
    pdf.set_text_color(*LARAN)
    pdf.set_x(14)
    pdf.cell(0, 5, '> ' + prob, ln=True)
    pdf.set_font('Helvetica', '', 8.5)
    pdf.set_text_color(*PRETO)
    pdf.set_x(20)
    pdf.multi_cell(180, 5, sol)
    pdf.ln(1)

# ── 3. MELHORIAS DE DESEMPENHO ────────────────────────────────────────────────
pdf.secao('*', 'O sistema ficou mais rapido', cor=VERDE)

pdf.item_ok('Listas de moradores e encomendas carregam em partes (50 por vez) - o sistema nao trava mais ao abrir paginas com muitos registros')
pdf.item_ok('Edicao de tarefas agora abre instantaneamente - antes havia uma demora visivelmente incômoda')
pdf.item_ok('Relatorios de dados carregam 98% mais rapido - em vez de buscar tudo toda vez, so busca o que mudou')
pdf.item_ok('Painel de TI mostra a velocidade de cada parte do sistema em tempo real')
pdf.ln(3)

# ── 4. SEGURANCA ───────────────────────────────────────────────────────────────
pdf.secao('#', 'Seguranca do sistema', cor=(107, 33, 168))

pdf.destaque(
    'O sistema passou por uma auditoria de seguranca. Todas as vulnerabilidades encontradas foram corrigidas.',
    cor=(245, 240, 255), texto_cor=(107, 33, 168)
)
pdf.ln(2)

pdf.item_ok('4 falhas de seguranca identificadas por ferramentas automaticas foram corrigidas')
pdf.item_ok('Limite de tentativas de login: apos 10 tentativas erradas por minuto, o acesso e bloqueado temporariamente')
pdf.item_ok('Token de sessao dura 7 dias: o usuario nao precisa fazer login todo dia')
pdf.item_ok('Dados de uma associacao nunca aparecem para operadores de outra associacao (isolamento total)')
pdf.ln(3)

# ── 5. DADOS E RELATORIOS ─────────────────────────────────────────────────────
pdf.secao('~', 'Dados e Relatorios Gerenciais (Dashboard)', cor=CINZA)

pdf.destaque(
    'Foi criada uma estrutura completa de dados analiticos para a diretoria acompanhar '
    'os indicadores das duas associacoes em um unico painel no Power BI.',
    cor=CINZAC, texto_cor=CINZA
)
pdf.ln(2)

pdf.tabela_simples('Relatorio Disponivel', 'O que mostra', [
    ('Receita diaria',               'Quanto entrou e saiu do caixa a cada dia'),
    ('Taxa de cobranca',             'Quantas mensalidades foram pagas vs emitidas (%)'),
    ('Inadimplencia',                'Lista de quem esta devendo, com valor e tempo de atraso'),
    ('Runway financeiro',            'Quantas semanas a associacao consegue operar com o saldo atual'),
    ('Crescimento de moradores',     'Quantos moradores novos entraram a cada semana'),
    ('Censo por rua',                'Distribuicao de moradores por rua, com indicadores sociais'),
    ('SLA de encomendas',            'Tempo medio para entregar uma encomenda depois de recebida'),
    ('Desempenho de operadores',     'Quantas encomendas cada operador recebeu e entregou'),
    ('Tarefas por colaborador',      'Produtividade de cada membro da equipe'),
    ('KPIs operacionais',            'Resumo executivo: caixas abertos, inadimplentes, tarefas em aberto'),
], w1=85, w2=105)

pdf.ln(2)
pdf.destaque(
    'Os dados sao atualizados automaticamente duas vezes por dia: as 9h e as 17h (horario de Brasilia).',
    cor=AZUL_L, texto_cor=AZUL
)

# ── 6. PENDENCIAS ─────────────────────────────────────────────────────────────
pdf.secao('...', 'O que ainda esta em andamento', cor=CINZA)

pdf.set_font('Helvetica', '', 8.5)
pendencias = [
    ('Dashboard Power BI - paginas visuais',
     'O modelo de dados esta pronto e conectado. Falta construir as 9 paginas de graficos no Power BI Desktop.',
     'Em andamento'),
    ('Moradores com endereco incorreto',
     '21 moradores tem o nome da rua digitado de forma errada no cadastro. Lista entregue ao admin para correcao manual.',
     'Aguardando admin'),
    ('Saldo do cofre de Congonha',
     'Congonha ainda nao utiliza o modulo de caixa do sistema, entao o saldo nao aparece no dashboard.',
     'Aguardando uso'),
]
for titulo, desc, status in pendencias:
    pdf.set_fill_color(*CINZAC)
    pdf.set_x(10)
    self_w = 190
    pdf.set_font('Helvetica', 'B', 8.5)
    pdf.set_text_color(*CINZA)
    pdf.cell(150, 6, '  ' + titulo, fill=True, border=0)
    cor_s = LARAN if status == 'Em andamento' else CINZA
    pdf.set_fill_color(*cor_s)
    pdf.set_text_color(*BRANCO)
    pdf.cell(40, 6, '  ' + status, fill=True, border=0)
    pdf.ln()
    pdf.set_font('Helvetica', '', 8)
    pdf.set_text_color(*PRETO)
    pdf.set_x(14)
    pdf.multi_cell(186, 5, desc)
    pdf.ln(2)

# SAVE
out = r'C:\Users\gonca\Documents\APRXM_Relatorio_Executivo_Jun2026.pdf'
pdf.output(out)
print('PDF gerado: ' + out)
