import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { createSession, listRecordings, type Recording } from '../lib/api'
import { Library } from '../components/Library'
import { Recorder } from '../components/Recorder'
import { Button, ErrorNote, Stage } from '../components/ui'
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
      .catch((e) => {
        setRecordings([])
        setError(e instanceof Error ? e.message : 'Could not load your recordings')
      })
  }, [])

  const update = useCallback((next: (prev: Recording[]) => Recording[]) => setRecordings((p) => next(p ?? [])), [])

  async function startSession() {
    setCreating(true)
    setError(null)
    try {
      const s = await createSession(name)
      saveHostToken(s.id, s.host_token!)
      navigate(`/s/${s.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the session')
      setCreating(false)
    }
  }

  return (
    <>
      <Stage>
        <div className="grid items-center gap-10 pt-6 lg:grid-cols-[1.05fr_1fr] lg:gap-6">
          <div>
            <h1 className="text-[clamp(3.5rem,9vw,7.5rem)] font-light leading-[0.92] tracking-[-0.03em]">
              Record.
              <br />
              Reshape.
              <br />
              Mix.
            </h1>
            <p className="mt-8 max-w-md text-lg leading-relaxed text-white/80">
              Capture your voice in the browser, reshape the take with effects that run on your own machine, then
              mix a whole room into one file.
            </p>
          </div>
          <Recorder onSaved={(r) => update((p) => [r, ...p])} />
        </div>
      </Stage>

      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-14 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="library-h">
          <h2 id="library-h" className="mb-6 text-3xl font-medium tracking-tight text-ink">
            Your library
          </h2>
          <Library recordings={recordings} onChange={update} />
        </section>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-2xl border border-line bg-card p-6">
            <h2 className="text-2xl font-medium tracking-tight text-ink">Record together</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-body">
              Start a session and share the link. Everyone’s microphone is mixed into one recording.
            </p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Session name (optional)"
              aria-label="Session name"
              className="mt-5 w-full rounded-xl border border-line-strong bg-paper px-4 py-2.5 text-ink placeholder:text-mute"
            />
            <Button variant="ink" onClick={startSession} disabled={creating} className="mt-3 w-full">
              {creating ? 'Starting…' : 'Start a session'}
            </Button>
            <div className="mt-3 empty:hidden">
              <ErrorNote error={error} />
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}
