import type { ConversationNotifier } from './conversationNotifier'

export interface BulkDownloadItem {
  src: string
  filename: string
  sourceKind: 'idb' | 'direct'
  cleanup?: () => void
}

export interface ConversationDownloadService {
  inferImageExtension: (src: string) => string
  downloadSingleImage: (input: {
    src: string
    filename: string
    cleanup?: () => void
  }) => Promise<void>
  downloadZipArchive: (input: {
    items: BulkDownloadItem[]
    archivePrefix: string
  }) => Promise<void>
}

async function toDownloadHref(src: string): Promise<{ href: string; revoke?: () => void }> {
  if (typeof window === 'undefined') {
    return { href: src }
  }

  if (/^https?:\/\//i.test(src)) {
    try {
      const response = await fetch(src)
      if (response.ok) {
        const blob = await response.blob()
        const href = URL.createObjectURL(blob)
        return {
          href,
          revoke: () => URL.revokeObjectURL(href),
        }
      }
    } catch {
      // Fall back to original source if fetch is blocked by CORS or network errors.
    }
  }

  return { href: src }
}

function triggerAnchorDownload(href: string, filename: string): void {
  if (typeof document === 'undefined') {
    return
  }
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export function inferImageExtension(src: string): string {
  if (src.startsWith('data:image/')) {
    const match = src.match(/^data:image\/([a-zA-Z0-9+.-]+);/i)
    const ext = match?.[1]?.toLowerCase() ?? 'png'
    return ext === 'jpeg' ? 'jpg' : ext
  }

  try {
    const parsed = new URL(src)
    const value = parsed.pathname.toLowerCase()
    if (value.endsWith('.png')) return 'png'
    if (value.endsWith('.jpg') || value.endsWith('.jpeg')) return 'jpg'
    if (value.endsWith('.webp')) return 'webp'
  } catch {
    // Ignore URL parsing errors and fallback to png.
  }

  return 'png'
}

export async function triggerSingleImageDownload(input: {
  src: string
  filename: string
  cleanup?: () => void
}): Promise<void> {
  const target = await toDownloadHref(input.src)
  triggerAnchorDownload(target.href, input.filename)

  if (target.revoke) {
    window.setTimeout(() => target.revoke?.(), 60_000)
  }
  const cleanup = input.cleanup
  if (cleanup) {
    window.setTimeout(() => cleanup(), 60_000)
  }
}

export async function triggerZipDownload(input: {
  items: BulkDownloadItem[]
  archivePrefix: string
  notifier: ConversationNotifier
}): Promise<void> {
  if (typeof document === 'undefined' || input.items.length === 0) {
    return
  }

  let JSZipCtor: new () => {
    file: (name: string, data: Blob) => void
    generateAsync: (options: {
      type: 'blob'
      compression: 'DEFLATE'
      compressionOptions: { level: number }
    }) => Promise<Blob>
  }

  try {
    const imported = await import('jszip')
    JSZipCtor = imported.default as unknown as typeof JSZipCtor
  } catch {
    input.notifier.error('压缩包模块加载失败，请重试。')
    return
  }

  const zip = new JSZipCtor()
  let addedCount = 0
  let failedCount = 0
  let blockedByCorsCount = 0

  for (const item of input.items) {
    try {
      if (item.sourceKind === 'direct' && /^https?:\/\//i.test(item.src)) {
        const parsed = new URL(item.src)
        if (typeof window !== 'undefined' && parsed.origin !== window.location.origin) {
          blockedByCorsCount += 1
          failedCount += 1
          continue
        }
      }

      const response = await fetch(item.src)
      if (!response.ok) {
        failedCount += 1
        continue
      }

      const blob = await response.blob()
      zip.file(item.filename, blob)
      addedCount += 1
    } catch {
      failedCount += 1
    } finally {
      item.cleanup?.()
    }
  }

  if (addedCount === 0) {
    input.notifier.error('下载失败：当前图片源不允许打包读取（跨域限制）。请重新生成后再试。')
    return
  }

  const archiveBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const downloadName = `${input.archivePrefix}-${timestamp}.zip`
  const href = URL.createObjectURL(archiveBlob)
  triggerAnchorDownload(href, downloadName)
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000)

  if (blockedByCorsCount > 0) {
    input.notifier.warning(`压缩包已下载，但有 ${blockedByCorsCount} 张为跨域远程图片，浏览器不允许打包。建议重新生成后再下载。`)
    return
  }
  if (failedCount > 0) {
    input.notifier.warning(`压缩包已下载，但有 ${failedCount} 张图片因跨域限制未能打包。`)
  }
}

export function createConversationDownloadService(notifier: ConversationNotifier): ConversationDownloadService {
  return {
    inferImageExtension,
    downloadSingleImage(input) {
      return triggerSingleImageDownload(input)
    },
    downloadZipArchive(input) {
      return triggerZipDownload({
        items: input.items,
        archivePrefix: input.archivePrefix,
        notifier,
      })
    },
  }
}
