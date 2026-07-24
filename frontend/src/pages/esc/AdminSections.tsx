import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { EscButton, escInputCls, escInputStyle } from './EscFormKit'
import EscDataTable from './EscDataTable'
import { escService } from '../../services/esc'

const BORDER = '#e2e8f0'
const TEXT_MUTED = '#64748b'

const MODULES = ['residents', 'packages', 'service_orders', 'finance', 'financeiro', 'admin', 'settings']
const MODULE_LABEL: Record<string, string> = {
  residents: 'Moradores', packages: 'Encomendas', service_orders: 'Ordens', finance: 'Operação de Caixa (unidade)',
  financeiro: 'Financeiro (ESC)', admin: 'Admin', settings: 'Config',
}
const PERMS = ['view', 'create', 'edit', 'delete']
const PERM_LABEL: Record<string, string> = { view: 'Ver', create: 'Criar', edit: 'Editar', delete: 'Excluir' }
const ROLES = ['operator', 'conferente', 'diretoria_adjunta', 'diretoria', 'conselho', 'admin']
const ROLE_LABEL: Record<string, string> = {
  operator: 'Operador', conferente: 'Conferente', diretoria_adjunta: 'Diretoria Adjunta',
  diretoria: 'Diretoria', conselho: 'Conselho', admin: 'Administrador',
}

type Groups = Record<string, Record<string, string[]>>

export function PermissoesSection() {
  const [groups, setGroups] = useState<Groups>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    escService.getAccessGroups().then((r) => setGroups(r.data || {})).catch(() => {})
  }, [])

  const has = (role: string, mod: string, perm: string) => (groups[role]?.[mod] ?? []).includes(perm)
  const toggle = (role: string, mod: string, perm: string) => {
    setGroups((g) => {
      const cur = new Set(g[role]?.[mod] ?? [])
      cur.has(perm) ? cur.delete(perm) : cur.add(perm)
      return { ...g, [role]: { ...(g[role] ?? {}), [mod]: [...cur] } }
    })
  }

  const save = async () => {
    setSaving(true)
    try { await escService.putAccessGroups(groups); toast.success('Permissões salvas.') }
    catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao salvar.') }
    finally { setSaving(false) }
  }

  return (
    <div className="px-6 py-4 overflow-auto" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <p className="text-xs mb-4" style={{ color: TEXT_MUTED }}>
        Controla o acesso ao Escritório (ESC) e às unidades de negócio — template único da empresa, vale para todas
        as unidades. superadmin/admin_master têm acesso total.
      </p>
      {MODULES.map((mod) => (
        <div key={mod} className="mb-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">{MODULE_LABEL[mod]}</h3>
          <table className="text-sm border-collapse">
            <thead>
              <tr className="border-b" style={{ borderColor: BORDER }}>
                <th className="text-left py-1 pr-4 font-medium" style={{ color: TEXT_MUTED }}>Cargo</th>
                {PERMS.map((p) => <th key={p} className="px-3 py-1 font-medium" style={{ color: TEXT_MUTED }}>{PERM_LABEL[p]}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROLES.map((role) => (
                <tr key={role} className="border-b" style={{ borderColor: BORDER }}>
                  <td className="py-1.5 pr-4">{ROLE_LABEL[role] ?? role}</td>
                  {PERMS.map((p) => (
                    <td key={p} className="px-3 py-1.5 text-center">
                      <input type="checkbox" checked={has(role, mod, p)} onChange={() => toggle(role, mod, p)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <EscButton onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar permissões'}</EscButton>
    </div>
  )
}

export function AvisosSection() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const send = async () => {
    if (!title.trim() || !body.trim()) { toast.error('Título e mensagem são obrigatórios.'); return }
    if (!confirm('Enviar aviso a TODOS os usuários ativos da empresa?')) return
    setSaving(true)
    try {
      const r = await escService.enviarAviso(title.trim(), body.trim())
      toast.success(`Aviso enviado a ${r.data.enviados} usuário(s).`)
      setTitle(''); setBody(''); setReloadKey((k) => k + 1)
    } catch (e: any) { toast.error(e.response?.data?.detail ?? 'Erro ao enviar.') }
    finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <div className="px-6 py-4 max-w-2xl border-b" style={{ borderColor: BORDER }}>
        <div className="flex flex-col gap-2">
          <input className={escInputCls} style={escInputStyle} placeholder="Título do aviso" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={escInputCls} style={escInputStyle} rows={3} placeholder="Mensagem" value={body} onChange={(e) => setBody(e.target.value)} />
          <div><EscButton onClick={send} disabled={saving}>{saving ? 'Enviando…' : 'Enviar broadcast'}</EscButton></div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <EscDataTable
          fetchFn={escService.listAvisos}
          reloadKey={reloadKey}
          columns={[
            { key: 'title', label: 'Título' },
            { key: 'body', label: 'Mensagem' },
            { key: 'destinatarios', label: 'Destinatários' },
            { key: 'enviado_em', label: 'Enviado em' },
          ]}
        />
      </div>
    </div>
  )
}
