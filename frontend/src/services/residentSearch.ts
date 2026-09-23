import api from './api'

// Busca de morador compartilhada por todo campo "buscar morador" do app.
// Antes cada tecla chamava a API direto: a resposta de uma busca antiga
// podia chegar depois da atual e sobrescrever a lista (17% das buscas saiam
// em rajada < 400ms -- achado real 2026-09-23, "às vezes o morador não
// aparece"). Aqui cada campo (chave) espera o usuário parar de digitar e só
// a resposta da busca mais recente vale; as superadas resolvem null.

const ESPERA_MS = 250

interface EstadoCampo {
  seq: number
  timer?: ReturnType<typeof setTimeout>
  liberar?: () => void
}

const campos = new Map<string, EstadoCampo>()

function estado(chave: string): EstadoCampo {
  let e = campos.get(chave)
  if (!e) {
    e = { seq: 0 }
    campos.set(chave, e)
  }
  return e
}

function descartarPendente(e: EstadoCampo): void {
  if (e.timer) clearTimeout(e.timer)
  e.liberar?.()
  e.liberar = undefined
}

/** Descarta a busca pendente do campo (ex.: o usuário apagou o texto). */
export function cancelarBuscaMoradores(chave: string): void {
  const e = estado(chave)
  e.seq++
  descartarPendente(e)
}

/**
 * Resolve com os moradores da busca MAIS RECENTE do campo `chave`,
 * ou `null` se ela foi superada por outra antes de terminar — nesse caso
 * quem chamou não deve mexer na tela.
 *
 * `espera: 0` pra campo que já espera o usuário parar de digitar por conta
 * própria (DebouncedInput, timer com SEARCH_DELAY) — somar as duas esperas
 * deixaria a busca lenta; o descarte de resposta antiga continua valendo.
 */
export function buscarMoradores<T = any>(
  chave: string,
  q: string,
  { params = {}, espera = ESPERA_MS }: { params?: Record<string, string>; espera?: number } = {},
): Promise<T[] | null> {
  const e = estado(chave)
  const minha = ++e.seq
  descartarPendente(e)
  return new Promise<T[] | null>((resolve, reject) => {
    e.liberar = () => resolve(null)
    e.timer = setTimeout(async () => {
      e.liberar = undefined
      try {
        const res = await api.get<T[]>('/residents/search', { params: { q, ...params } })
        resolve(minha === e.seq ? res.data : null)
      } catch (err) {
        if (minha === e.seq) reject(err)
        else resolve(null)
      }
    }, espera)
  })
}
