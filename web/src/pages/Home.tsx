import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { createSession, listRecordings, type Recording } from '../lib/api'
import { Library } from '../components/Library'
import { Recorder } from '../components/Recorder'
import { Button, Card, ErrorNote, inputClass, Spinner } from '../components/ui'
import { useTitle } from '../lib/hooks'
import { saveHostToken } from '../lib/session'

export default function Home() {
  useTitle('timbre — voice recorder')
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(() => {
    setLoadError(null)
    listRecordings()
      .then(setRecordings)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load recordings'))
  }, [])

  useEffect(load, [load])

  const update = useCallback((next: (prev: Recording[]) => Recording[]) => setRecordings((p) => next(p ?? [])), [])

  async function startSession(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const s = await createSession(name.trim())
      saveHostToken(s.id, s.host_token!)
      navigate(`/s/${s.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create session')
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <Recorder onSaved={(r) => update((p) => [r, ...p])} />
      <Card>
        <h2 className="mb-1 text-base font-semibold text-ink">Record together</h2>
        <p className="mb-3 text-sm text-mute">Start a session, share the link, and everyone’s mic is mixed into one recording.</p>
        <form className="flex flex-wrap gap-3" onSubmit={startSession}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Session name (optional)"
            aria-label="Session name"
            className={`${inputClass} flex-1`}
          />
          <Button type="submit" disabled={creating}>
            {creating ? <><Spinner /> Starting…</> : 'Start session'}
          </Button>
        </form>
        <div className="mt-3">
          <ErrorNote error={error} />
        </div>
      </Card>
      <div>
        <h2 className="mb-3 text-base font-semibold text-ink">Library</h2>
        {loadError ? (
          <ErrorNote error={loadError}>
            <Button onClick={load} className="!py-0.5">Retry</Button>
          </ErrorNote>
        ) : (
          <Library recordings={recordings} onChange={update} />
        )}
      </div>
    </div>
  )
}
