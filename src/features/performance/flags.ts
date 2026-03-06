export const ENABLE_LAZY_SETTINGS = true
export const ENABLE_MESSAGE_WINDOWING = true
export const ENABLE_PROGRESSIVE_IMAGE_RENDER = true
export const ENABLE_PROGRESSIVE_COMMIT = true
export const ENABLE_IDLE_STORAGE_BATCH = true
export const ENABLE_RUNTIME_METRICS = import.meta.env.DEV && import.meta.env.VITE_ENABLE_RUNTIME_METRICS === 'true'

export const PERFORMANCE_DEFAULTS = {
  maxRunConcurrency: 4,
  maxImageConcurrency: 6,
}
