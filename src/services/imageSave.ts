const directoryHandleMap = new Map<string, FileSystemDirectoryHandle>()

type BrowserWindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; startIn?: 'desktop' | 'documents' | 'downloads' }) => Promise<FileSystemDirectoryHandle>
}

function getDirectoryPicker(): BrowserWindowWithDirectoryPicker['showDirectoryPicker'] {
  if (typeof window === 'undefined') {
    return undefined
  }
  return (window as BrowserWindowWithDirectoryPicker).showDirectoryPicker
}

function inferImageExtension(src: string): string {
  if (src.startsWith('data:image/')) {
    const match = src.match(/^data:image\/([a-zA-Z0-9+.-]+);/i)
    if (!match) {
      return 'png'
    }
    const ext = match[1].toLowerCase()
    if (ext === 'jpeg') {
      return 'jpg'
    }
    return ext
  }

  try {
    const parsed = new URL(src)
    const cleaned = parsed.pathname.toLowerCase()
    if (cleaned.endsWith('.png')) return 'png'
    if (cleaned.endsWith('.jpg') || cleaned.endsWith('.jpeg')) return 'jpg'
    if (cleaned.endsWith('.webp')) return 'webp'
  } catch {
    // Ignore URL parse errors and fallback to png.
  }

  return 'png'
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/i)
  if (!match) {
    throw new Error('Invalid data URL')
  }

  const mime = match[1] || 'application/octet-stream'
  const isBase64 = Boolean(match[2])
  const dataPart = match[3] ?? ''

  if (isBase64) {
    const binary = atob(dataPart)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new Blob([bytes], { type: mime })
  }

  const text = decodeURIComponent(dataPart)
  return new Blob([text], { type: mime })
}

async function imageSrcToBlob(imageSrc: string): Promise<Blob> {
  if (imageSrc.startsWith('data:')) {
    return dataUrlToBlob(imageSrc)
  }

  const response = await fetch(imageSrc)
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status})`)
  }
  return response.blob()
}

function safeFileName(raw: string): string {
  return raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
}

function makeFileName(input: { batchId: string; runId: string; seq: number; ext: string }): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const stem = `${timestamp}_${input.batchId}_${input.runId}_${input.seq}`
  return `${safeFileName(stem)}.${input.ext}`
}

async function saveByDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  filename: string,
  imageSrc: string,
): Promise<void> {
  const blob = await imageSrcToBlob(imageSrc)
  const fileHandle = await handle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
}

function makeDirectoryKey(handle: FileSystemDirectoryHandle): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `picked:${handle.name}:${Date.now()}:${random}`
}

export function isSaveDirectoryReady(saveDirectory: string | undefined): boolean {
  if (!saveDirectory) {
    return false
  }
  return directoryHandleMap.has(saveDirectory)
}

export async function pickSaveDirectory(): Promise<{ saveDirectory: string; directoryName: string } | null> {
  const picker = getDirectoryPicker()
  if (!picker) {
    return null
  }

  const handle = await picker({ mode: 'readwrite', startIn: 'downloads' })
  const saveDirectory = makeDirectoryKey(handle)
  directoryHandleMap.set(saveDirectory, handle)
  return { saveDirectory, directoryName: handle.name }
}

export async function autoSaveImage(input: {
  imageSrc: string
  saveDirectory: string | undefined
  batchId: string
  runId: string
  seq: number
}): Promise<boolean> {
  if (typeof document === 'undefined') {
    console.warn('[autoSaveImage] document unavailable')
    return false
  }

  if (!input.saveDirectory) {
    console.warn('[autoSaveImage] saveDirectory missing')
    return false
  }
  const handle = directoryHandleMap.get(input.saveDirectory)
  if (!handle) {
    console.warn('[autoSaveImage] directory handle not found, path likely needs re-authorization')
    return false
  }
  const ext = inferImageExtension(input.imageSrc)
  const filename = makeFileName({
    batchId: input.batchId,
    runId: input.runId,
    seq: input.seq,
    ext,
  })

  try {
    await saveByDirectoryHandle(handle, filename, input.imageSrc)
    return true
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[autoSaveImage] save failed: ${reason}`)
    return false
  }
}
