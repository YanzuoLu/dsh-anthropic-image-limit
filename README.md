# dsh-anthropic-image-limit

Keeps every image DeepSeek Harness (dsh) sends to Anthropic within Anthropic's per-side limit.

## Why

Anthropic rejects a request that carries many images when any image side exceeds 3000 px:

```
At least one of the image dimensions exceed max allowed size for many-image requests: 3000 pixels
```

`dsh-llm-pi-ai` scales request images only by a total pixel budget (about 4.19 megapixels by default). A long strip under that budget, such as 3360×384, is sent with its full 3360 px side, and every following request in that conversation fails. dsh's own DeepSeek adapter already caps the long edge of every request image; the pi-ai adapter does not.

## Behavior

- Wraps the global `fetch` and inspects only `POST …/v1/messages` requests whose string body is an Anthropic Messages payload containing images. All other traffic passes through unchanged.
- Resizes only base64 images whose longest side exceeds `maxEdge`, keeping the aspect ratio. Images inside `tool_result` blocks are included. URL and file sources are untouched.
- JPEG and WebP are re-encoded at quality 85, PNG stays PNG, and GIF becomes a still PNG.
- The limit applies to every image regardless of how many a request carries, so a history image is always sent identically. Resized results are cached by content, keeping repeated requests byte-identical for prompt caching.
- When no image needs resizing, the original request arguments are sent as-is. Images that cannot be decoded are sent unchanged so Anthropic reports the actual problem.
- Works with both OAuth and API-key requests, and coexists with other fetch wrappers such as `dsh-anthropic-auth` in either order.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxEdge` | `3000` | Longest side, in pixels, of any image sent to Anthropic Messages |

## Install

```sh
dsh plugin --profile web add github:YanzuoLu/dsh-anthropic-image-limit
```

No dsh restart is required with a live profile.

## Removal

This is an interim fix. Remove the plugin once `dsh-llm-pi-ai` enforces a per-side request-image limit itself.
