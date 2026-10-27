// The transport seam. dsh-llm-pi-ai scales request images only by a total
// pixel budget, so a long strip under that budget can still exceed the side
// limit Anthropic enforces on requests that carry many images. This fetch
// resizes only images whose longest side is over the limit, in the final
// Anthropic Messages payload; every other request and body passes through.
import { createHash } from 'node:crypto'

const MESSAGES_PATH = /\/v1\/messages$/

/** Resized results kept so a resent history image yields identical bytes without re-encoding. */
const CACHE_LIMIT = 64

/** Output encoding per accepted Anthropic media type; GIF becomes a still PNG. */
const OUTPUTS = {
  'image/jpeg': ['jpeg', { quality: 85 }],
  'image/png': ['png', {}],
  'image/webp': ['webp', { quality: 85 }],
  'image/gif': ['png', {}],
}

/**
 * @typedef {object} ImageLimitFetchOptions
 * @property {typeof fetch} baseFetch - the fetch every request is dispatched through.
 * @property {number} maxEdge - the longest side, in pixels, any sent image may have.
 * @property {typeof import('sharp')} sharp - the image codec.
 */

/**
 * Build the side-limiting fetch. The limit applies to every image regardless
 * of how many a request carries, so a history image is always sent the same
 * way and the prompt-cache prefix stays stable.
 * @param {ImageLimitFetchOptions} options
 * @returns {typeof fetch}
 */
export function createImageLimitFetch({ baseFetch, maxEdge, sharp }) {
  const cache = new Map()

  /** Replacement for one base64 source, or `undefined` to send it unchanged. */
  function limited(source) {
    const key = createHash('sha256').update(source.media_type ?? '').update('\0').update(source.data).digest('base64')
    let entry = cache.get(key)
    if (entry === undefined) {
      entry = resize(source)
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value)
    } else {
      cache.delete(key)
    }
    cache.set(key, entry)
    return entry
  }

  async function resize(source) {
    const output = OUTPUTS[source.media_type]
    if (output === undefined) return undefined
    const input = Buffer.from(source.data, 'base64')
    const [format, options] = output
    try {
      const { width, height } = await sharp(input).metadata()
      if (!width || !height || Math.max(width, height) <= maxEdge) return undefined
      const data = await sharp(input)
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
        .toFormat(format, options)
        .toBuffer()
      return { data: data.toString('base64'), media_type: `image/${format}` }
    } catch {
      return undefined // undecodable: send it unchanged and let Anthropic report the actual problem
    }
  }

  return async function imageLimitFetch(input, init) {
    const payload = messagesPayload(input, init)
    if (payload === undefined) return baseFetch(input, init)
    const sources = base64ImageSources(payload.messages)
    if (sources.length === 0) return baseFetch(input, init)
    const results = await Promise.all(sources.map(limited))
    if (results.every((result) => result === undefined)) return baseFetch(input, init)
    results.forEach((result, index) => {
      if (result !== undefined) Object.assign(sources[index], result)
    })
    const headers = new Headers(init.headers)
    headers.delete('content-length')
    return baseFetch(input, { ...init, headers, body: JSON.stringify(payload) })
  }
}

/**
 * The parsed body of an Anthropic Messages request that may carry images, else `undefined`.
 * @param {Parameters<typeof fetch>[0]} input
 * @param {RequestInit | undefined} init
 */
function messagesPayload(input, init) {
  if (init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string' || !init.body.includes('"image"')) return undefined
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!MESSAGES_PATH.test(url.pathname)) return undefined
  let payload
  try {
    payload = JSON.parse(init.body)
  } catch {
    return undefined
  }
  return payload !== null && typeof payload === 'object' && typeof payload.model === 'string' && Array.isArray(payload.messages)
    ? payload
    : undefined
}

/**
 * Every base64 image source in message content, including tool results.
 * @param {object[]} messages
 * @returns {{ media_type?: string, data: string }[]}
 */
export function base64ImageSources(messages) {
  const sources = []
  const visit = (blocks) => {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
      if (block?.type === 'image' && block.source?.type === 'base64' && typeof block.source.data === 'string') sources.push(block.source)
      else if (block?.type === 'tool_result') visit(block.content)
    }
  }
  for (const message of messages) visit(message?.content)
  return sources
}
