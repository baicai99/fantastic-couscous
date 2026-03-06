export interface PersistedImageTask {
  id: string
  conversationId: string
  runId: string
  imageId: string
  seq: number
  channelId: string | null
  serverTaskId?: string
  serverTaskMeta?: Record<string, string>
  createdAt: string
  updatedAt: string
}

const STORAGE_IMAGE_TASKS_KEY = 'm3:image-task-registry'

export function makeImageTaskId(conversationId: string, runId: string, imageId: string): string {
  return `${conversationId}:${runId}:${imageId}`
}

export function loadImageTasks(): PersistedImageTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_IMAGE_TASKS_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as PersistedImageTask[]
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item) =>
      item &&
      typeof item.id === 'string' &&
      typeof item.conversationId === 'string' &&
      typeof item.runId === 'string' &&
      typeof item.imageId === 'string' &&
      typeof item.seq === 'number',
    )
  } catch {
    return []
  }
}

function saveImageTasks(tasks: PersistedImageTask[]): void {
  localStorage.setItem(STORAGE_IMAGE_TASKS_KEY, JSON.stringify(tasks))
}

export function upsertImageTask(task: PersistedImageTask): void {
  const tasks = loadImageTasks()
  const next = tasks.filter((item) => item.id !== task.id)
  next.push(task)
  saveImageTasks(next)
}

export function removeImageTask(taskId: string): void {
  const tasks = loadImageTasks()
  const next = tasks.filter((item) => item.id !== taskId)
  if (next.length === tasks.length) {
    return
  }
  saveImageTasks(next)
}

export function removeImageTasksForConversation(conversationId: string): void {
  const tasks = loadImageTasks()
  const next = tasks.filter((item) => item.conversationId !== conversationId)
  if (next.length === tasks.length) {
    return
  }
  saveImageTasks(next)
}

export function replaceImageTasksForConversation(conversationId: string, nextTasks: PersistedImageTask[]): void {
  const tasks = loadImageTasks()
  const rest = tasks.filter((item) => item.conversationId !== conversationId)
  saveImageTasks([...rest, ...nextTasks])
}

export function clearImageTasks(): void {
  localStorage.removeItem(STORAGE_IMAGE_TASKS_KEY)
}
