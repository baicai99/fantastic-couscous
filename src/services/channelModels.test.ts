import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchChannelModelEntries, fetchChannelModels } from './channelModels'

describe('channelModels', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses provider discoverModelEntries when available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-image-1', owned_by: 'openai' },
          { id: 'gpt-4o-mini', owned_by: 'openai' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const entries = await fetchChannelModelEntries({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      providerId: 'openai-compatible',
    })

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      id: 'gpt-image-1',
      metadata: { id: 'gpt-image-1', owned_by: 'openai' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps discoverModels behavior for id-only listing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-image-1' },
          { id: 'gpt-4o-mini' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const models = await fetchChannelModels({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      providerId: 'openai-compatible',
    })

    expect(models).toEqual(['gpt-image-1', 'gpt-4o-mini'])
  })
})

