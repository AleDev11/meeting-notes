import { Agent, fetch, FormData } from 'undici'

// Las reuniones largas pueden tardar varios minutos en procesarse.
const dispatcher = new Agent({ headersTimeout: 30 * 60_000, bodyTimeout: 30 * 60_000 })

export async function request<T>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: Buffer | FormData | string }
): Promise<T> {
  const res = await fetch(url, { ...init, dispatcher })
  const text = await res.text()
  if (!res.ok) {
    let detail: unknown = text
    try {
      const j = JSON.parse(text)
      detail = j.detail?.message ?? j.detail ?? j.error ?? j.err_msg ?? j.message ?? text
    } catch {
      /* texto plano */
    }
    if (typeof detail !== 'string') detail = JSON.stringify(detail)
    throw new Error(`${new URL(url).hostname} ${res.status}: ${detail}`)
  }
  return JSON.parse(text) as T
}

export { FormData }
