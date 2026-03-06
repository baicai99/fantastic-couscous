const WINDOWS_FILE_NAME_MAX = 255
const ILLEGAL_FILE_CHAR_PATTERN = /[<>:"/\\|?*\x00-\x1F]/g
const TRAILING_DOT_SPACE_PATTERN = /[.\s]+$/g
const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

function sanitizeSegment(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? '')
    .replace(ILLEGAL_FILE_CHAR_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TRAILING_DOT_SPACE_PATTERN, '')
  const safe = normalized || fallback
  return RESERVED_WINDOWS_NAMES.has(safe.toUpperCase()) ? `${safe}_` : safe
}

function sanitizeExtension(ext: string): string {
  const normalized = ext
    .replace(ILLEGAL_FILE_CHAR_PATTERN, '')
    .replace(/^\.+/, '')
    .trim()
    .toLowerCase()
  return normalized || 'png'
}

function truncateStem(stem: string, ext: string): string {
  const maxStemLength = Math.max(1, WINDOWS_FILE_NAME_MAX - ext.length - 1)
  const safeStem = stem.replace(TRAILING_DOT_SPACE_PATTERN, '')
  const symbols = Array.from(safeStem)
  if (symbols.length <= maxStemLength) {
    return safeStem || 'image'
  }

  const truncated = symbols.slice(0, maxStemLength).join('').trim().replace(TRAILING_DOT_SPACE_PATTERN, '')
  return truncated || 'image'
}

export interface ImageFileNameInput {
  modelName?: string | null
  prompt?: string | null
  seq?: number
  ext: string
  timestamp?: string
  suffix?: string
}

export function buildImageFileName(input: ImageFileNameInput): string {
  const timestamp = sanitizeSegment(
    input.timestamp ?? new Date().toISOString().replace(/[:.]/g, '-'),
    'time',
  )
  const modelName = sanitizeSegment(input.modelName, 'model')
  const prompt = sanitizeSegment(input.prompt, 'prompt')
  const seq = typeof input.seq === 'number' ? Math.max(1, Math.floor(input.seq)) : null
  const suffix = input.suffix ? sanitizeSegment(input.suffix, '') : ''
  const ext = sanitizeExtension(input.ext)

  const parts = [modelName, timestamp, prompt]
  if (suffix) {
    parts.push(suffix)
  }
  if (seq) {
    parts.push(`#${seq}`)
  }

  const stem = truncateStem(
    parts.join('_'),
    ext,
  )
  return `${stem}.${ext}`
}
