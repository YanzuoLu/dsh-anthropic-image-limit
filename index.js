/**
 * Side limit for images DeepSeek Harness (dsh) sends to Anthropic.
 *
 * dsh-llm-pi-ai scales request images only by a total pixel budget. A long
 * strip under that budget, such as 3360x384, keeps a side above the 3000 px
 * Anthropic accepts in requests that carry many images, and the whole request
 * is rejected. This plugin resizes only such oversized images in the outgoing
 * Anthropic Messages payload. Remove it once dsh-llm-pi-ai enforces a per-side
 * limit itself, as dsh's DeepSeek adapter already does.
 *
 * @module dsh-anthropic-image-limit
 */
import z from '@deepseek-ai/schemastery'
import sharp from 'sharp'
import { createImageLimitFetch } from './lib/image-limit-fetch.js'

export const name = 'anthropic-image-limit'

export const Config = z.object({
  maxEdge: z.natural().min(1).default(3000)
    .description('Longest side, in pixels, of any image sent to Anthropic Messages.'),
})

/**
 * Install the side-limiting fetch for this plugin's lifetime.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ maxEdge: number }} config
 */
export function apply(ctx, config) {
  ctx.effect(() => installFetch(config.maxEdge), 'anthropic-image-limit fetch')
}

/** Wrap the global fetch; an inactive wrapper kept by a later wrapper passes through. */
function installFetch(maxEdge) {
  const original = globalThis.fetch
  let active = true
  const limitFetch = createImageLimitFetch({ baseFetch: (input, init) => original(input, init), maxEdge, sharp })
  const wrapper = (input, init) => (active ? limitFetch(input, init) : original(input, init))
  globalThis.fetch = wrapper
  return () => {
    active = false
    if (globalThis.fetch === wrapper) globalThis.fetch = original
  }
}
