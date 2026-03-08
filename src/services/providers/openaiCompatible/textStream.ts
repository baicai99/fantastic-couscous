import type { NormalizedTextRequest, ProviderError } from '../../../types/provider'

function extractTextFragment(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractTextFragment(item)).filter(Boolean).join('')
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>

  if (typeof record.text === 'string') {
    return record.text
  }

  const directFields = [
    record.text,
    record.value,
    record.output_text,
    record.content,
    record.message,
    record.part,
    record.item,
    record.output,
    record.response,
  ]

  for (const field of directFields) {
    const extracted = extractTextFragment(field)
    if (extracted) {
      return extracted
    }
  }

  if (typeof record.delta === 'string') {
    return record.delta
  }

  return ''
}

function extractChoiceText(choice: unknown): string {
  if (!choice || typeof choice !== 'object') {
    return ''
  }

  const record = choice as Record<string, unknown>
  const delta = record.delta
  if (delta && typeof delta === 'object') {
    const deltaRecord = delta as Record<string, unknown>
    const deltaContent = extractTextFragment(deltaRecord.content)
    if (deltaContent) {
      return deltaContent
    }

    const deltaText = extractTextFragment(deltaRecord.text)
    if (deltaText) {
      return deltaText
    }

    const deltaOutputText = extractTextFragment(deltaRecord.output_text)
    if (deltaOutputText) {
      return deltaOutputText
    }
  }

  const directFields = [record.message, record.text, record.output_text, record.content]
  for (const field of directFields) {
    const extracted = extractTextFragment(field)
    if (extracted) {
      return extracted
    }
  }

  return ''
}

export function extractStreamDeltaText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const record = payload as Record<string, unknown>
  const choices = record.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const choiceText = extractChoiceText(choices[0])
    if (choiceText) {
      return choiceText
    }
  }

  const directFields = [record.delta, record.output_text, record.text, record.part, record.item, record.response, record.message]
  for (const field of directFields) {
    const extracted = extractTextFragment(field)
    if (extracted) {
      return extracted
    }
  }

  return ''
}

export async function streamOpenAICompatibleText(input: {
  url: string
  apiKey: string
  request: NormalizedTextRequest
  onDelta: (chunk: string) => void
  onDone?: () => void
  onError?: (error: ProviderError) => void
  isAbortError: (error: unknown) => boolean
  createProviderError: (input: {
    message: string
    code?: ProviderError['code']
    status?: number
    retriable?: boolean
    detail?: string
  }) => ProviderError
}): Promise<void> {
  const body: Record<string, unknown> = {
    model: input.request.modelId,
    messages: input.request.messages.map((item) => ({
      role: item.role,
      content: item.content,
    })),
    stream: true,
  }
  if (typeof input.request.temperature === 'number' && Number.isFinite(input.request.temperature)) {
    body.temperature = input.request.temperature
  }
  if (typeof input.request.topP === 'number' && Number.isFinite(input.request.topP)) {
    body.top_p = input.request.topP
  }
  if (typeof input.request.maxTokens === 'number' && Number.isFinite(input.request.maxTokens)) {
    body.max_tokens = Math.max(1, Math.floor(input.request.maxTokens))
  }

  try {
    const response = await fetch(input.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.request.signal,
    })

    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).trim()
      } catch {
        detail = ''
      }
      throw input.createProviderError({
        message: `HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        code:
          response.status === 401 || response.status === 403
            ? 'auth'
            : response.status === 429
              ? 'rate_limit'
              : response.status >= 500
                ? 'provider_unavailable'
                : 'unknown',
        status: response.status,
        detail,
        retriable: response.status === 429 || response.status >= 500,
      })
    }

    if (!response.body) {
      throw input.createProviderError({
        message: 'stream response body is empty',
        code: 'unknown',
      })
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let finished = false

    const consumeEventBlock = (block: string) => {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())

      if (lines.length === 0) {
        return
      }
      const payloadText = lines.join('\n')
      if (!payloadText) {
        return
      }
      if (payloadText === '[DONE]') {
        finished = true
        return
      }

      let parsed: unknown = null
      try {
        parsed = JSON.parse(payloadText) as unknown
      } catch {
        return
      }
      const deltaText = extractStreamDeltaText(parsed)
      if (deltaText) {
        input.onDelta(deltaText)
      }
    }

    while (!finished) {
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode().replace(/\r\n/g, '\n')
        break
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

      let splitIndex = buffer.indexOf('\n\n')
      while (splitIndex >= 0) {
        const eventBlock = buffer.slice(0, splitIndex)
        buffer = buffer.slice(splitIndex + 2)
        consumeEventBlock(eventBlock)
        if (finished) {
          break
        }
        splitIndex = buffer.indexOf('\n\n')
      }
    }

    if (!finished && buffer.trim().length > 0) {
      consumeEventBlock(buffer)
    }
    input.onDone?.()
  } catch (error) {
    if (input.isAbortError(error)) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
    const normalized = error && typeof error === 'object' && 'providerId' in error
      ? (error as ProviderError)
      : input.createProviderError({
        message: error instanceof Error ? error.message : 'text stream failed',
        code: 'unknown',
      })
    input.onError?.(normalized)
    throw normalized
  }
}
