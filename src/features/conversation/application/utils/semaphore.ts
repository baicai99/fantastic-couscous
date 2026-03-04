export class Semaphore {
  private readonly max: number
  private active = 0
  private queue: Array<() => void> = []

  constructor(max: number) {
    this.max = Math.max(1, Math.floor(max))
  }

  private async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1
      return
    }

    await new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1)
    const next = this.queue.shift()
    if (next) {
      next()
    }
  }

  async use<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}
