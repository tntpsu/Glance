// Glasses bridge for Glance. Single full-screen text container for the
// reader/article-list views, plus a list-container modal picker for
// source / article selection. Mirrors the patterns proven in Pulse's
// even.ts (BLE-write serialization, modal rebuild flow, double-tap routing).

import {
  CreateStartUpPageContainer,
  EventSourceType,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

const MAIN_ID = 1
const MAIN_NAME = 'main'
const HEADER_ID = 20
const HEADER_NAME = 'pick_hdr'
const LIST_ID = 21
const LIST_NAME = 'pick_list'
const BRIDGE_TIMEOUT_MS = 4000
const WIDTH = 576
const HEIGHT = 288

export type SwipeDirection = 'up' | 'down'
export type InputSource = 'glasses' | 'ring' | 'unknown'

export interface EvenRuntime {
  render: (text: string) => Promise<void>
  onTap: (handler: (source: InputSource) => void) => void
  onSwipe: (handler: (dir: SwipeDirection, source: InputSource) => void) => void
  onDoubleTap: (handler: (source: InputSource) => void) => void
  onForeground: (handler: () => void) => void
  openPicker: (header: string, options: string[]) => Promise<number | null>
  exitApp: () => Promise<void>
  // Native companion-app key/value storage. More durable than browser
  // localStorage on iOS WebView kill cycles.
  getStorage: (key: string) => Promise<string>
  setStorage: (key: string, value: string) => Promise<boolean>
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
    containerID: MAIN_ID,
    containerName: MAIN_NAME,
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

  // BLE writes must be serialized — concurrent textContainerUpgrade /
  // rebuildPageContainer calls crash the connection per SDK warnings.
  let busy: Promise<unknown> = Promise.resolve()
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = busy.then(work, work) as Promise<T>
    busy = next.then(() => undefined, () => undefined)
    return next
  }

  async function writeMain(text: string): Promise<void> {
    if (text === lastSent) return
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: MAIN_ID,
        containerName: MAIN_NAME,
        contentOffset: 0,
        contentLength: Math.max(lastLen, text.length),
        content: text,
      }),
    )
    lastSent = text
    lastLen = text.length
  }

  // --- input wiring ---

  let tapHandler: ((source: InputSource) => void) | null = null
  let swipeHandler: ((dir: SwipeDirection, source: InputSource) => void) | null = null
  let doubleTapHandler: ((source: InputSource) => void) | null = null
  let foregroundHandler: (() => void) | null = null
  // When non-null, a modal picker is open. Input events route through the
  // resolver instead of the normal handlers.
  let modalResolver: ((value: number | null) => void) | null = null

  function classifySource(src: number | undefined): InputSource {
    if (src === EventSourceType.TOUCH_EVENT_FROM_RING) return 'ring'
    if (
      src === EventSourceType.TOUCH_EVENT_FROM_GLASSES_L ||
      src === EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
    ) {
      return 'glasses'
    }
    return 'unknown'
  }

  bridge.onEvenHubEvent(event => {
    if (modalResolver) {
      // Modal-open event routing.
      if (event.listEvent) {
        const idx = event.listEvent.currentSelectItemIndex ?? 0
        const resolve = modalResolver
        modalResolver = null
        resolve(idx)
        return
      }
      if (event.sysEvent) {
        const t = event.sysEvent.eventType ?? 0
        if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
          const resolve = modalResolver
          modalResolver = null
          resolve(null)
          return
        }
        if (t === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
          foregroundHandler?.()
          return
        }
      }
      return
    }
    if (event.textEvent) {
      const t = event.textEvent.eventType ?? 0
      if (t === OsEventTypeList.SCROLL_TOP_EVENT) swipeHandler?.('up', 'unknown')
      else if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT) swipeHandler?.('down', 'unknown')
      return
    }
    if (event.sysEvent) {
      const t = event.sysEvent.eventType ?? 0
      const src = classifySource(event.sysEvent.eventSource)
      if (t === 0) {
        tapHandler?.(src)
        return
      }
      if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        doubleTapHandler?.(src)
        return
      }
      if (t === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
        foregroundHandler?.()
        return
      }
    }
  })

  // --- modal picker ---

  async function rebuildToMain(): Promise<void> {
    const m = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: WIDTH,
      height: HEIGHT,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 6,
      containerID: MAIN_ID,
      containerName: MAIN_NAME,
      content: lastSent,
      isEventCapture: 1,
    })
    await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [m],
      }),
    )
  }

  async function openPicker(header: string, options: string[]): Promise<number | null> {
    if (modalResolver) return null
    const HEADER_H = 64
    const LIST_H = HEIGHT - HEADER_H
    const headerText = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: WIDTH,
      height: HEADER_H,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 6,
      containerID: HEADER_ID,
      containerName: HEADER_NAME,
      content: header,
      isEventCapture: 0,
    })
    const list = new ListContainerProperty({
      xPosition: 0,
      yPosition: HEADER_H,
      width: WIDTH,
      height: LIST_H,
      borderWidth: 1,
      borderColor: 8,
      borderRadius: 4,
      paddingLength: 4,
      containerID: LIST_ID,
      containerName: LIST_NAME,
      itemContainer: new ListItemContainerProperty({
        itemCount: options.length,
        itemWidth: 0,
        isItemSelectBorderEn: 1,
        itemName: options,
      }),
      isEventCapture: 1,
    })
    return enqueue(async () => {
      await bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 2,
          textObject: [headerText],
          listObject: [list],
        }),
      )
      try {
        return await new Promise<number | null>(resolve => {
          modalResolver = resolve
        })
      } finally {
        modalResolver = null
        await rebuildToMain()
      }
    })
  }

  return {
    async render(text: string): Promise<void> {
      await enqueue(() => writeMain(text))
    },
    onTap(handler) { tapHandler = handler },
    onSwipe(handler) { swipeHandler = handler },
    onDoubleTap(handler) { doubleTapHandler = handler },
    onForeground(handler) { foregroundHandler = handler },
    openPicker,
    async exitApp(): Promise<void> {
      await bridge.shutDownPageContainer(1)
    },
    async getStorage(key: string): Promise<string> {
      try {
        return await bridge.getLocalStorage(key)
      } catch {
        return ''
      }
    },
    async setStorage(key: string, value: string): Promise<boolean> {
      try {
        return await bridge.setLocalStorage(key, value)
      } catch {
        return false
      }
    },
  }
}
