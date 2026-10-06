// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { flush, mount } from '../../test/render'
import { fetchCached, resetLoadCache, useLoaded } from './load'

beforeEach(() => resetLoadCache())
afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers() })

function Show({ id, load }: { id: string | null; load: () => Promise<string> }) {
  const state = useLoaded(id, load)
  return <div>{state.status === 'ready' ? `ready:${state.value}` : state.status === 'error' ? `error:${state.message}` : 'loading'}</div>
}

describe('fetchCached', () => {
  it('shares one request between callers asking for the same key at the same time', async () => {
    const load = vi.fn(() => new Promise<string>(resolve => setTimeout(() => resolve('x'), 5)))
    const [a, b] = await Promise.all([fetchCached('k', load), fetchCached('k', load)])
    expect([a, b]).toEqual(['x', 'x'])
    expect(load).toHaveBeenCalledOnce()
  })

  it('lets a failed request be retried', async () => {
    await expect(fetchCached('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(fetchCached('k', () => Promise.resolve('ok'))).resolves.toBe('ok')
  })
})

describe('useLoaded', () => {
  it('goes from loading to ready', async () => {
    const ui = mount(<Show id="a" load={() => Promise.resolve('one')} />)
    expect(ui.container.textContent).toBe('loading')
    await flush()
    expect(ui.container.textContent).toBe('ready:one')
    ui.unmount()
  })

  it('shows the error message when loading fails', async () => {
    const ui = mount(<Show id="a" load={() => Promise.reject(new Error('Not Found'))} />)
    await flush()
    expect(ui.container.textContent).toBe('error:Not Found')
    ui.unmount()
  })

  it('shows the last result at once and does not refetch within a minute', async () => {
    const load = vi.fn(() => Promise.resolve('one'))
    const first = mount(<Show id="a" load={load} />)
    await flush()
    first.unmount()
    const second = mount(<Show id="a" load={load} />)
    expect(second.container.textContent).toBe('ready:one')
    await flush()
    expect(load).toHaveBeenCalledOnce()
    second.unmount()
  })

  it('refreshes a result older than a minute, showing the old one meanwhile', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const load = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new')
    const first = mount(<Show id="a" load={load} />)
    await flush()
    first.unmount()
    vi.setSystemTime(Date.now() + 61_000)
    const second = mount(<Show id="a" load={load} />)
    expect(second.container.textContent).toBe('ready:old')
    await flush()
    expect(second.container.textContent).toBe('ready:new')
    second.unmount()
  })

  it('loads nothing for a null key, and loads again when the key changes', async () => {
    const load = vi.fn(() => Promise.resolve('x'))
    const ui = mount(<Show id={null} load={load} />)
    await flush()
    expect(load).not.toHaveBeenCalled()
    ui.render(<Show id="b" load={load} />)
    await flush()
    expect(load).toHaveBeenCalledOnce()
    expect(ui.container.textContent).toBe('ready:x')
    ui.unmount()
  })
})
