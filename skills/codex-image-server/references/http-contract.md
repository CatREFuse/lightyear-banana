# HTTP Contract

## Health

`GET /healthz`

```json
{
  "status": "ok",
  "auth_required": false,
  "backend": "codex-exec",
  "generation_timeout_ms": 600000,
  "log_file": "/Users/example/.codex/logs/lightyear-banana/image-server.jsonl",
  "model": "gpt-image-2",
  "output_dir": "/absolute/path"
}
```

## Capabilities

`GET /v1/capabilities`

Requires `X-API-Key: {API Key}` only when `CODEX_IMAGE_SERVER_API_KEY` is set.

Return the model, supported output formats, quality options, max images, ratio options, size options, and size constraints.

Important values:

- `auth_required`: `true` when `CODEX_IMAGE_SERVER_API_KEY` is set, otherwise `false`
- `model`: `gpt-image-2`
- `generation_timeout_ms`: request timeout for each generation worker, default `600000`
- `max_images`: `4`
- `qualities`: `auto`, `high`, `medium`, `low`
- `references.mode`: `original_image`
- `size_constraints.max_edge`: `3840`
- `size_constraints.multiple_of`: `16`

## Generate

`POST /v1/images/generate`

Requires `X-API-Key: {API Key}` only when `CODEX_IMAGE_SERVER_API_KEY` is set.

```json
{
  "prompt": "red product poster",
  "count": 4,
  "size": "1024x1024",
  "quality": "high",
  "aspect": "1:1",
  "output_format": "png",
  "references": [
    {
      "label": "visible layer",
      "image": "data:image/png;base64,..."
    }
  ]
}
```

Response:

```json
{
  "status": "completed",
  "backend": "codex-exec",
  "model": "gpt-image-2",
  "requested_size": "1024x1024",
  "quality": "high",
  "data": [
    {
      "id": "codex-...",
      "label": "生成图",
      "mime_type": "image/png",
      "path": "/absolute/output.png",
      "resolved_size": "1024x1024",
      "url": "http://127.0.0.1:17341/v1/images/codex-.../file"
    }
  ]
}
```

## Image File

`GET /v1/images/:id/file`

Requires `X-API-Key: {API Key}` only when `CODEX_IMAGE_SERVER_API_KEY` is set.

Return the generated image bytes with the correct image content type.

## Cancellation

The server must abort work when:

- the caller aborts the request,
- the socket closes before completion,
- the configured timeout is reached,
- one worker fails during a multi-image request.

On macOS and Linux, start `codex exec` with `detached: true` and kill the negative process id so child processes do not remain alive.

## Logs

The server writes JSONL logs to `~/.codex/logs/lightyear-banana/image-server.jsonl` by default. Override the location with `CODEX_IMAGE_SERVER_LOG_DIR` or `CODEX_IMAGE_SERVER_LOG_FILE`.

Required event names:

- `server.listen`
- `generate.start`
- `generate.success`
- `generate.error`
- `generate.abort`
- `codex.exec.start`
- `codex.exec.success`
- `codex.exec.error`

Do not write bearer tokens, full prompts, complete request headers, or raw base64 images into logs. A generation request may log `prompt_length`, `reference_count`, `requested_size`, `resolved_size`, `quality`, `count`, `request_id`, duration, and output paths.
