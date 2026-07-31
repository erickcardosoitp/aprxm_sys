"""Helpers de banco compartilhados entre routers -- evita replicar a mesma
string de filtro SQL em vários arquivos."""

# Exclui associações de homologação/teste e unidades marcadas para exclusão
# das listagens agregadas do ESC (visão de produção por padrão).
PROD_ASSOC_FILTER = "a.plan_name IS DISTINCT FROM 'Homologação' AND a.name NOT LIKE '%DELETADO%'"
