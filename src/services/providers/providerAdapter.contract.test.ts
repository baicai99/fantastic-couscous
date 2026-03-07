import { afterEach, describe, expect, it, vi } from 'vitest'
import { midjourneyAdapter } from './midjourneyAdapter'
import { openAICompatibleAdapter } from './openaiCompatibleAdapter'

const openAiChannel = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'k',
}

describe('provider adapter contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('openai-compatible supports discoverModels and discoverModelEntries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-image-1' }, { id: 'gpt-4o-mini' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const ids = await openAICompatibleAdapter.discoverModels(openAiChannel)
    const entries = await openAICompatibleAdapter.discoverModelEntries?.(openAiChannel)

    expect(ids).toEqual(['gpt-image-1', 'gpt-4o-mini'])
    expect(entries?.map((item) => item.id)).toEqual(ids)
    expect(entries?.[0]?.metadata).toMatchObject({ id: 'gpt-image-1' })
  })

  it('midjourney streamText returns unsupported_param', async () => {
    await expect(
      midjourneyAdapter.streamText({
        channel: {
          id: 'mj',
          name: 'mj',
          baseUrl: 'https://api.example.com/mj',
          apiKey: 'k',
        },
        request: {
          modelId: 'midjourney-v7',
          messages: [{ role: 'user', content: 'hello' }],
        },
        onDelta: () => {},
      }),
    ).rejects.toMatchObject({
      code: 'unsupported_param',
      providerId: 'midjourney-proxy',
    })
  })

  it('normalizeError returns provider-scoped error', () => {
    const openaiError = openAICompatibleAdapter.normalizeError(new Error('boom'))
    const midjourneyError = midjourneyAdapter.normalizeError(new Error('boom'))

    expect(openaiError.providerId).toBe('openai-compatible')
    expect(midjourneyError.providerId).toBe('midjourney-proxy')
  })
})

