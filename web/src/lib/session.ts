// Per-browser identity for multiplayer sessions (localStorage, best effort).
function get(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function set(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode: identity just won't survive a reload */
  }
}

export const saveHostToken = (sessionId: string, token: string) => set(`timbre.host.${sessionId}`, token)
export const getHostToken = (sessionId: string) => get(`timbre.host.${sessionId}`)

/** Stable per-browser id so a reload/reconnect resumes the same track. */
export function clientId() {
  let id = get('timbre.client')
  if (!id) {
    id = crypto.randomUUID()
    set('timbre.client', id)
  }
  return id
}

export const savedName = () => get('timbre.name') ?? ''
export const saveName = (n: string) => set('timbre.name', n)
