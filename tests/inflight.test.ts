// Unit tests for the concurrency primitives in src/inflight.ts.

import { describe, expect, it, vi } from 'vitest'
import {
  dedupedFetch,
  makeGenerationCounter,
  makeWriteSerializer,
} from '../src/inflight'

describe('dedupedFetch', () => {
  it('runs factory once for a single call', async () => {
    const map = new Map<string, Promise<number>>()
    const factory = vi.fn(async () => 42)
    const r = await dedupedFetch(map, 'k', factory)
    expect(r).toBe(42)
    expect(factory).toHaveBeenCalledOnce()
  })

  it('collapses two concurrent calls for same key into one factory invocation', async () => {
    const map = new Map<string, Promise<number>>()
    let resolveFactory: ((v: number) => void) | null = null
    const factory = vi.fn(() => new Promise<number>(r => { resolveFactory = r }))
    const a = dedupedFetch(map, 'k', factory)
    const b = dedupedFetch(map, 'k', factory)
    expect(factory).toHaveBeenCalledOnce()
    resolveFactory!(99)
    expect(await a).toBe(99)
    expect(await b).toBe(99)
  })

  it('runs factory again after first call settles (entry cleaned up)', async () => {
    const map = new Map<string, Promise<number>>()
    let count = 0
    const factory = async () => ++count
    expect(await dedupedFetch(map, 'k', factory)).toBe(1)
    expect(await dedupedFetch(map, 'k', factory)).toBe(2)
    expect(map.size).toBe(0)
  })

  it('different keys run independent factories', async () => {
    const map = new Map<string, Promise<string>>()
    const a = dedupedFetch(map, 'k1', async () => 'A')
    const b = dedupedFetch(map, 'k2', async () => 'B')
    expect(await a).toBe('A')
    expect(await b).toBe('B')
  })

  it('cleans up entry on factory rejection', async () => {
    const map = new Map<string, Promise<number>>()
    await expect(
      dedupedFetch(map, 'k', async () => { throw new Error('boom') }),
    ).rejects.toThrow('boom')
    expect(map.size).toBe(0)
  })

  it('rejected promise is shared by both concurrent callers', async () => {
    const map = new Map<string, Promise<number>>()
    const factory = vi.fn(async () => { throw new Error('shared error') })
    const a = dedupedFetch(map, 'k', factory).catch(e => e.message)
    const b = dedupedFetch(map, 'k', factory).catch(e => e.message)
    expect(await a).toBe('shared error')
    expect(await b).toBe('shared error')
    expect(factory).toHaveBeenCalledOnce()
  })
})

describe('makeWriteSerializer', () => {
  it('runs writes in submission order', async () => {
    const serialize = makeWriteSerializer()
    const log: number[] = []
    const a = serialize(async () => { await sleep(20); log.push(1) })
    const b = serialize(async () => { await sleep(5); log.push(2) })
    const c = serialize(async () => { log.push(3) })
    await Promise.all([a, b, c])
    expect(log).toEqual([1, 2, 3])
  })

  it('does not let a second writer start before the first finishes', async () => {
    const serialize = makeWriteSerializer()
    let aDone = false
    const a = serialize(async () => { await sleep(20); aDone = true })
    const b = serialize(async () => {
      // When B's body actually runs, A must have completed.
      expect(aDone).toBe(true)
    })
    await Promise.all([a, b])
  })

  it('error in one write does not poison subsequent writes', async () => {
    const serialize = makeWriteSerializer()
    await expect(serialize(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    const result = await serialize(async () => 'survived')
    expect(result).toBe('survived')
  })

  it('preserves return value of each write', async () => {
    const serialize = makeWriteSerializer()
    const a = serialize(async () => 'a')
    const b = serialize(async () => 42)
    const c = serialize(async () => ({ x: 1 }))
    expect(await a).toBe('a')
    expect(await b).toBe(42)
    expect(await c).toEqual({ x: 1 })
  })
})

describe('makeGenerationCounter', () => {
  it('starts at 0; first next() returns 1', () => {
    const g = makeGenerationCounter()
    expect(g.current()).toBe(0)
    expect(g.next()).toBe(1)
    expect(g.current()).toBe(1)
  })

  it('increments monotonically', () => {
    const g = makeGenerationCounter()
    g.next(); g.next(); g.next()
    expect(g.current()).toBe(3)
    expect(g.next()).toBe(4)
  })

  it('two counters are independent', () => {
    const g1 = makeGenerationCounter()
    const g2 = makeGenerationCounter()
    g1.next(); g1.next()
    g2.next()
    expect(g1.current()).toBe(2)
    expect(g2.current()).toBe(1)
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
