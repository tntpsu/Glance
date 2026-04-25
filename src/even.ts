// Minimal glasses-bridge wrapper. Single full-screen text container — Glance
// is text-only at every layer (sources picker, article list, paginated body)
// so we don't need the dual-column dashboard layout that PhilsHome uses.
//
// Future implementation tasks will extend this with: openPicker for the
// sources / article-list selection, swipe & double-tap routing, native
// storage helpers (setLocalStorage/getLocalStorage) for the article cache.

import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

const CONTAINER_ID = 1
const CONTAINER_NAME = 'main'
const BRIDGE_TIMEOUT_MS = 4000
const WIDTH = 576
const HEIGHT = 288

export interface EvenRuntime {
  render: (text: string) => Promise<void>
  exitApp: () => Promise<void>
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('Timed out waiting for the Even bridge')),
      timeoutMs,
    )
    promise.then(
      v => { window.clearTimeout(timer); resolve(v) },
      e => { window.clearTimeout(timer); reject(e) },
    )
  })
}

export async function connectEvenRuntime(initial: string): Promise<EvenRuntime | null> {
  let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>>
  try {
    bridge = await withTimeout(waitForEvenAppBridge(), BRIDGE_TIMEOUT_MS)
  } catch {
    return null
  }

  const main = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: WIDTH,
    height: HEIGHT,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 6,
    containerID: CONTAINER_ID,
    containerName: CONTAINER_NAME,
    content: initial,
    isEventCapture: 1,
  })

  const created = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [main],
    }),
  )
  if (created !== 0) return null

  let lastSent = initial
  let lastLen = initial.length

  // BLE writes must be serialized — concurrent textContainerUpgrade calls
  // crash the connection per the SDK warning. Future picker / image work
  // will use this same enqueue.
  let busy: Promise<unknown> = Promise.resolve()
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = busy.then(work, work) as Promise<T>
    busy = next.then(() => undefined, () => undefined)
    return next
  }

  return {
    async render(text: string): Promise<void> {
      if (text === lastSent) return
      await enqueue(async () => {
        await bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: CONTAINER_ID,
            containerName: CONTAINER_NAME,
            contentOffset: 0,
            contentLength: Math.max(lastLen, text.length),
            content: text,
          }),
        )
        lastSent = text
        lastLen = text.length
      })
    },
    async exitApp(): Promise<void> {
      await bridge.shutDownPageContainer(1)
    },
  }
}
