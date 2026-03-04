export interface ResolutionRule {
  resolution: string
  tier: '' | '2K' | '4K'
  aspectRatio: string
}

export type SizeTier = '0.5K' | '1K' | '2K' | '4K'

export const RESOLUTION_RULES: ResolutionRule[] = [
  { resolution: '1024x1024', tier: '', aspectRatio: '1:1' },
  { resolution: '2048x2048', tier: '2K', aspectRatio: '1:1' },
  { resolution: '4096x4096', tier: '4K', aspectRatio: '1:1' },
  { resolution: '832x1248', tier: '', aspectRatio: '2:3' },
  { resolution: '848x1264', tier: '', aspectRatio: '2:3' },
  { resolution: '1696x2528', tier: '2K', aspectRatio: '2:3' },
  { resolution: '3392x5056', tier: '4K', aspectRatio: '2:3' },
  { resolution: '1248x832', tier: '', aspectRatio: '3:2' },
  { resolution: '1264x848', tier: '', aspectRatio: '3:2' },
  { resolution: '2528x1696', tier: '2K', aspectRatio: '3:2' },
  { resolution: '5056x3392', tier: '4K', aspectRatio: '3:2' },
  { resolution: '864x1184', tier: '', aspectRatio: '3:4' },
  { resolution: '896x1200', tier: '', aspectRatio: '3:4' },
  { resolution: '1792x2400', tier: '2K', aspectRatio: '3:4' },
  { resolution: '3584x4800', tier: '4K', aspectRatio: '3:4' },
  { resolution: '1184x864', tier: '', aspectRatio: '4:3' },
  { resolution: '1200x896', tier: '', aspectRatio: '4:3' },
  { resolution: '2400x1792', tier: '2K', aspectRatio: '4:3' },
  { resolution: '4800x3584', tier: '4K', aspectRatio: '4:3' },
  { resolution: '896x1152', tier: '', aspectRatio: '4:5' },
  { resolution: '928x1152', tier: '', aspectRatio: '4:5' },
  { resolution: '1856x2304', tier: '2K', aspectRatio: '4:5' },
  { resolution: '3712x4608', tier: '4K', aspectRatio: '4:5' },
  { resolution: '1152x896', tier: '', aspectRatio: '5:4' },
  { resolution: '1152x928', tier: '', aspectRatio: '5:4' },
  { resolution: '2304x1856', tier: '2K', aspectRatio: '5:4' },
  { resolution: '4608x3712', tier: '4K', aspectRatio: '5:4' },
  { resolution: '768x1344', tier: '', aspectRatio: '9:16' },
  { resolution: '768x1376', tier: '', aspectRatio: '9:16' },
  { resolution: '1536x2752', tier: '2K', aspectRatio: '9:16' },
  { resolution: '3072x5504', tier: '4K', aspectRatio: '9:16' },
  { resolution: '1344x768', tier: '', aspectRatio: '16:9' },
  { resolution: '1376x768', tier: '', aspectRatio: '16:9' },
  { resolution: '2752x1536', tier: '2K', aspectRatio: '16:9' },
  { resolution: '5504x3072', tier: '4K', aspectRatio: '16:9' },
  { resolution: '1536x672', tier: '', aspectRatio: '21:9' },
  { resolution: '1584x672', tier: '', aspectRatio: '21:9' },
  { resolution: '3168x1344', tier: '2K', aspectRatio: '21:9' },
  { resolution: '6336x2688', tier: '4K', aspectRatio: '21:9' },
]

export function getAspectRatioOptions(): string[] {
  return Array.from(new Set(RESOLUTION_RULES.map((item) => item.aspectRatio)))
}

export function getResolutionsByAspectRatio(aspectRatio: string): ResolutionRule[] {
  return RESOLUTION_RULES.filter((item) => item.aspectRatio === aspectRatio)
}

export function getResolutionRule(value: string): ResolutionRule | null {
  const key = value.trim().toLowerCase()
  const matched = RESOLUTION_RULES.find((item) => item.resolution.toLowerCase() === key)
  return matched ?? null
}

export function getSizeTierOptions(): SizeTier[] {
  return ['0.5K', '1K', '2K', '4K']
}

export function normalizeSizeTier(value: string | undefined): SizeTier {
  const upper = value?.trim().toUpperCase()
  if (upper === '0.5K' || upper === '2K' || upper === '4K') {
    return upper
  }
  if (upper === '1K') {
    return '1K'
  }

  const mapped = value ? getResolutionRule(value) : null
  if (mapped?.tier === '2K') {
    return '2K'
  }
  if (mapped?.tier === '4K') {
    return '4K'
  }
  return '1K'
}

function parseResolution(value: string): { width: number; height: number } | null {
  const match = value.match(/^(\d+)x(\d+)$/i)
  if (!match) {
    return null
  }
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
}

function toResolution(width: number, height: number): string {
  return `${Math.round(width)}x${Math.round(height)}`
}

export function getComputedPresetResolution(aspectRatio: string, tier: SizeTier): string | null {
  if (tier === '0.5K') {
    const base = RESOLUTION_RULES.find((item) => item.aspectRatio === aspectRatio && item.tier === '')
    const parsed = base ? parseResolution(base.resolution) : null
    if (!parsed) {
      return null
    }
    return toResolution(parsed.width / 2, parsed.height / 2)
  }

  const targetTier = tier === '1K' ? '' : tier
  const matched = RESOLUTION_RULES.find((item) => item.aspectRatio === aspectRatio && item.tier === targetTier)
  return matched?.resolution ?? null
}
