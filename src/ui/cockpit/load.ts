import { useEffect, useRef, useState } from 'react'

export type Loaded<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; message: string }

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const CACHE_MS = 60_000
const cache = new Map<string, { at: number; value: unknown }>()
const inFlight = new Map<string, Promise<unknown>>()

// For tests: forget everything loaded so far.
export function resetLoadCache() {
  cache.clear()
  inFlight.clear()
}

// One request per key at a time, so two panels asking for the same story's
// links share a fetch.
export function fetchCached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key)
  if (pending) return pending as Promise<T>
  const request = load()
    .then(value => { cache.set(key, { at: Date.now(), value }); return value })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

// Shows the last result at once and refreshes it when it's older than a minute.
// A null key loads nothing.
export function useLoaded<T>(key: string | null, load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    if (!key) { setState({ status: 'loading' }); return }
    let live = true
    const hit = cache.get(key)
    setState(hit ? { status: 'ready', value: hit.value as T } : { status: 'loading' })
    if (hit && Date.now() - hit.at < CACHE_MS) return
    fetchCached(key, () => loadRef.current())
      .then(value => { if (live) setState({ status: 'ready', value }) })
      .catch(e => { if (live) setState({ status: 'error', message: errorText(e) }) })
    return () => { live = false }
  }, [key])
  return state
}
