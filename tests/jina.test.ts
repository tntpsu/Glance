import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyBody } from '../src/jina'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => readFileSync(join(HERE, 'fixtures', name), 'utf8')

describe('classifyBody', () => {
  it('flags too-short bodies', () => {
    const result = classifyBody('Just a few chars.')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('too-short')
  })

  it('flags paywall pages by signature phrase', () => {
    const md = fixture('article-paywalled.txt')
    const result = classifyBody(md)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('paywall')
  })

  it('flags bot-wall pages (ESPN response)', () => {
    const md = fixture('espn-botwall.txt')
    const result = classifyBody(md)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('bot-wall')
  })

  it('flags javascript-required nag as bot-wall', () => {
    const md = `Some title\n\n${'x'.repeat(250)}\n\nJavaScript is disabled. Enable it to continue.`
    const result = classifyBody(md)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('bot-wall')
  })

  it('flags subscriber-only', () => {
    const md = `# Article Title\n\n${'lorem ipsum dolor sit amet '.repeat(20)}This article is for subscribers only.`
    const result = classifyBody(md)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('paywall')
  })

  it('passes a real article body fixture', () => {
    // The github fixture is a real github README — long, structured, no paywall.
    const md = fixture('article-github.txt')
    const result = classifyBody(md)
    expect(result.ok).toBe(true)
  })

  it('passes a synthetic clean article', () => {
    const md = `# A long enough article\n\n${'This is body text that does not contain any paywall phrases at all. '.repeat(15)}`
    const result = classifyBody(md)
    expect(result.ok).toBe(true)
  })
})
