import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { createSession, listRecordings, type Recording } from '../lib/api'
import { Library } from '../components/Library'
import { Recorder } from '../components/Recorder'
import { Button, Card, ErrorNote } from '../components/ui'
import { saveHostToken } from '../lib/session'

export default function Home() {
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    listRecordings()
      .then(setRecordings)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load recordings'))
  }, [])

  const update = useCallback((next: (prev: Recording[]) => Recording[]) => setRecordings((p) => next(p ?? [])), [])

  async function startSession() {
    setCreating(true)
    try {
      const s = await createSession(name)
      saveHostToken(s.id, s.host_token!)
      navigate(`/s/${s.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create session')
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <Recorder onSaved={(r) => update((p) => [r, ...p])} />
      <Card>
        <h2 className="mb-1 text-base font-semibold text-ink">Record together</h2>
        <p className="mb-3 text-sm text-mute">Start a session, share the link, and everyone’s mic is mixed into one recording.</p>
        <div className="flex gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Session name (optional)"
            aria-label="Session name"
            className="min-w-0 flex-1 rounded-md border border-hairline-strong bg-canvas px-3 py-1.5 text-sm text-ink"
          />
          <Button onClick={startSession} disabled={creating}>
            Start session
          </Button>
        </div>
      </Card>
      <ErrorNote error={error} />
      <div>
        <h2 className="mb-3 text-base font-semibold text-ink">Library</h2>
        <Library recordings={recordings} onChange={update} />
      </div>
    </div>
  )
}
