import { describe, expect, it } from 'vitest'
import { Semaphore } from '../utils/semaphore'

describe('Semaphore', () => {
  it('limits concurrent tasks', async () => {
    const semaphore = new Semaphore(2)
    let active = 0
    let maxSeen = 0

    await Promise.all(
      Array.from({ length: 8 }, async (_, index) =>
        semaphore.use(async () => {
          active += 1
          maxSeen = Math.max(maxSeen, active)
          await new Promise((resolve) => setTimeout(resolve, 5 + index))
          active -= 1
        }),
      ),
    )

    expect(maxSeen).toBeLessThanOrEqual(2)
  })
})
