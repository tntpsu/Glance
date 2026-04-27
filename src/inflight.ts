// Concurrency primitives for the fetch + cache pipeline.
//
// Three real race windows surfaced in the v0.5.5 → v0.5.6 audit:
//
//   1. Same-URL double-fetch: two rapid taps on an article both miss
//      cache + both fire adapter.fetchArticleBody → 2× rate-limit hit
//      against r.jina.ai. dedupedFetch() collapses them into one.
//
//   2. Cache-index write race: read-modify-write on the body index
//      isn't atomic; two concurrent putCachedBody calls can lose
//      each other's eviction work. serializeWrite() funnels them
//      through a single promise chain.
//
//   3. openArticle re-entrance: late-resolving fetch overwrites
//      currentArticle/currentPages after the user has navigated
//      elsewhere. generation() returns a counter — stamp at start,
//      check at end, drop the result if it changed.
//
// All three primitives are pure and testable in isolation.

/**
 * Collapse concurrent calls for the same key into a single promise.
 * If `key` is already in flight, return the existing promise.
 * Otherwise call `factory()`, store the resulting promise, and clean
 * up after settle.
 */
export function dedupedFetch<T>(
  map: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key)
  if (existing) return existing
  const promise = factory().finally(() => {
    // Only delete if this is still the active promise for the key —
    // protects against a rare-but-real case where a fast re-entry
    // replaces the entry between map.set and finally.
    if (map.get(key) === promise) map.delete(key)
  })
  map.set(key, promise)
  return promise
}

/**
 * Serialize async writes through a single chain. Returns a function
 * that wraps `work` in a chain after any pending writes. Errors in
 * one work unit don't break the chain — subsequent writes still run.
 *
 * Use case: `putCachedBody` reads the body-index, mutates it, and
 * writes back. Two concurrent calls without serialization can lose
 * each other's mutations. With this wrapper, B waits for A's full
 * read-modify-write to finish before starting its own.
 */
export function makeWriteSerializer(): <T>(work: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>) => {
    const next = chain.then(work, work) as Promise<T>
    // Errors in `work` mustn't poison the chain — swallow them at the
    // chain-tracking level (caller still sees the rejected `next`).
    chain = next.then(() => undefined, () => undefined)
    return next
  }
}

/**
 * Generation counter — caller increments at the start of an async
 * operation, captures the value, and checks at end before applying
 * results. If the captured value doesn't match the current value,
 * the operation is stale and its result should be dropped.
 *
 * Used in main.ts openArticle so a slow fetch from article A doesn't
 * apply its body to currentArticle when the user has already navigated
 * to article B.
 */
export function makeGenerationCounter(): {
  next: () => number
  current: () => number
} {
  let n = 0
  return {
    next: () => ++n,
    current: () => n,
  }
}
