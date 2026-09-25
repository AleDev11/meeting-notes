import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, ShieldAlert, WifiOff, XCircle } from 'lucide-react'
import type { ApiKeys, KeyCheck } from '@shared/types'
import { quick, Spinner } from './ui'

export interface KeyInfo {
  id: keyof ApiKeys
  name: string
  use: string
  url: string
  /** Pasos para conseguir la key, en orden. */
  steps: string[]
}

export const KEYS: KeyInfo[] = [
  {
    id: 'deepgram',
    name: 'Deepgram',
    use: 'Transcripción en vivo con hablantes',
    url: 'https://console.deepgram.com/',
    steps: [
      'Crea una cuenta en la consola de Deepgram. Incluye crédito gratuito al empezar.',
      'Entra en tu proyecto y abre API Keys.',
      'Pulsa Create a New API Key, ponle un nombre y copia la key.'
    ]
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    use: 'Transcripción en vivo y final',
    url: 'https://elevenlabs.io/app/developers/api-keys',
    steps: [
      'Inicia sesión o crea una cuenta en ElevenLabs.',
      'En Developers > API Keys, pulsa Create API Key.',
      'Activa el permiso Speech to Text (el resto puede quedar sin acceso) y copia la key.'
    ]
  },
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    use: 'Transcripción final con hablantes',
    url: 'https://www.assemblyai.com/dashboard/api-keys',
    steps: ['Crea una cuenta en AssemblyAI.', 'En el panel, abre API Keys.', 'Copia la key que aparece o crea una nueva.']
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    use: 'Resúmenes y deducción de nombres',
    url: 'https://platform.claude.com/settings/keys',
    steps: [
      'Inicia sesión en la consola de Claude.',
      'Ve a Settings > API Keys y pulsa Create Key.',
      'Añade saldo en Billing: sin él, la key no puede generar resúmenes.'
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    use: 'Resúmenes y deducción de nombres',
    url: 'https://platform.openai.com/api-keys',
    steps: [
      'Inicia sesión en la plataforma de desarrolladores de OpenAI.',
      'Pulsa Create new secret key y copia la key.',
      'Añade saldo en Billing: sin él, la key no puede generar resúmenes.'
    ]
  }
]

export const keyInfo = (id: keyof ApiKeys): KeyInfo => KEYS.find((k) => k.id === id)!

export type KeyState = KeyCheck | 'checking' | null

/** Estado de comprobación de cada key; descarta respuestas que llegan tarde. */
export function useKeyChecks(): {
  checks: Partial<Record<keyof ApiKeys, KeyState>>
  check: (id: keyof ApiKeys, value: string) => Promise<void>
  clear: (id: keyof ApiKeys) => void
} {
  const [checks, setChecks] = useState<Partial<Record<keyof ApiKeys, KeyState>>>({})
  const seq = useRef<Partial<Record<keyof ApiKeys, number>>>({})

  const clear = useCallback((id: keyof ApiKeys) => {
    seq.current[id] = (seq.current[id] ?? 0) + 1
    setChecks((c) => ({ ...c, [id]: null }))
  }, [])

  const check = useCallback(async (id: keyof ApiKeys, value: string) => {
    const n = (seq.current[id] = (seq.current[id] ?? 0) + 1)
    if (!value.trim()) return setChecks((c) => ({ ...c, [id]: null }))
    setChecks((c) => ({ ...c, [id]: 'checking' }))
    let result: KeyCheck
    try {
      result = await window.api.checkKey(id, value)
    } catch {
      result = { status: 'error', message: 'No se ha podido comprobar la key.' }
    }
    if (seq.current[id] === n) setChecks((c) => ({ ...c, [id]: result }))
  }, [])

  return { checks, check, clear }
}

const ICONS = {
  valid: <CheckCircle2 size={14} />,
  invalid: <XCircle size={14} />,
  forbidden: <ShieldAlert size={14} />,
  network: <WifiOff size={14} />,
  error: <AlertCircle size={14} />
}

/** Línea de estado bajo el campo de la key. */
export function KeyStatus({ state, name, onRetry }: { state: KeyState; name: string; onRetry: () => void }): React.JSX.Element {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {state && (
        <motion.span
          key={state === 'checking' ? 'checking' : state.status + state.message}
          className={`key-status ${state === 'checking' ? 'checking' : state.status}`}
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={quick}
          role="status"
        >
          {state === 'checking' ? (
            <>
              <Spinner size={12} /> Comprobando con {name}…
            </>
          ) : (
            <>
              {ICONS[state.status]}
              <span>{state.message}</span>
              {(state.status === 'network' || state.status === 'error') && (
                <button className="link" onClick={onRetry}>
                  Reintentar
                </button>
              )}
            </>
          )}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

/** Campo de API key oculto por defecto, con el estado de la comprobación en el borde. */
export function KeyInput({
  value,
  onChange,
  state,
  autoFocus
}: {
  value: string
  onChange: (v: string) => void
  state?: KeyState
  autoFocus?: boolean
}): React.JSX.Element {
  const [show, setShow] = useState(false)
  const tone = !state || state === 'checking' ? '' : state.status === 'valid' ? 'is-valid' : 'is-invalid'
  return (
    <div className={`key-input ${tone}`}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        placeholder="Pega aquí la API key"
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.trim())}
      />
      <button className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar' : 'Mostrar'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}
