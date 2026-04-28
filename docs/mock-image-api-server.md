# 生图 API Mock Server 手册

更新时间：2026-04-27

## 启动

```bash
node scripts/mock-image-api-server.mjs
```

默认地址：

```text
http://127.0.0.1:38322
```

成功生图响应默认会随机等待 3 到 5 秒。可以用环境变量调整：

```bash
LIGHTYEAR_MOCK_IMAGE_API_DELAY_MIN_MS=3000 \
LIGHTYEAR_MOCK_IMAGE_API_DELAY_MAX_MS=5000 \
node scripts/mock-image-api-server.mjs
```

也可以指定端口：

```bash
LIGHTYEAR_MOCK_IMAGE_API_PORT=38322 node scripts/mock-image-api-server.mjs
```

前端设置页打开 `Mock Server` 后，OpenAI、Google Gemini、Qwen-Image、Kling、Seedream、自定义 OpenAI 兼容配置都会请求这个本地地址。

关闭 `Mock Server` 时，前端会按 Provider 直接请求真实 API。自定义 OpenAI 兼容配置使用配置里的 Base URL。

## 可用模型

| Provider | 前端模型声明 | Mock endpoint |
| --- | --- | --- |
| OpenAI | `gpt-image-2` | `POST /v1/images/generations`、`POST /v1/images/edits` |
| Google Gemini | `gemini-3-pro-image-preview`、`gemini-2.5-flash-image` | `POST /v1beta/models/{model}:generateContent` |
| Qwen-Image | `qwen-image-2.0-pro`、`qwen-image-edit-max`、`qwen-image-edit-plus` | `POST /api/v1/services/aigc/multimodal-generation/generation` |
| Kling | `kling/kling-v3-image-generation`、`kling/kling-v3-omni-image-generation` | `POST /api/v1/services/aigc/multimodal-generation/generation`、`GET /api/v1/tasks/{task_id}` |
| Seedream | `seedream-4-0-250828` | `POST /api/v3/images/generations` |
| OpenAI compatible | `custom-image-model` | `POST /v1/images/generations`、`POST /v1/images/edits` |

模型声明已经同步到 `src/data/providerCapabilities.ts`。Google 模型以当前官方图像生成文档可查到的 `gemini-3-pro-image-preview` 和 `gemini-2.5-flash-image` 为准。

## API Key

Good case：

| Provider | API Key |
| --- | --- |
| 全部 Provider | `mock-good` |
| OpenAI | `mock-good-openai` |
| Google Gemini | `mock-good-gemini` |
| Qwen-Image | `mock-good-qwen` |
| Kling | `mock-good-kling` |
| Seedream | `mock-good-seedream` |
| OpenAI compatible | `mock-good-compatible` |

Bad case：

| API Key | 预期状态 |
| --- | --- |
| `mock-bad-key` | 401 invalid key |
| `mock-expired` | 401 expired key |
| `mock-permission-denied` | 403 permission denied |
| `mock-rate-limited` | 429 rate limit |
| `mock-quota-exceeded` | 429 quota exceeded |
| `mock-server-error` | 500 server error |
| `mock-timeout` | 504 timeout |

## 返回结构

Mock Server 使用项目内 20 张 CC0 猫咪照片作为返回结果。每次成功请求都会随机抽样，Kling 的创建任务和任务结果会保持同一组随机图片：

```text
public/mock-images/cats/cat-01.jpg
...
public/mock-images/cats/cat-20.jpg
```

这些 fixture 来自 Wikimedia Commons，授权和来源写在 `public/mock-images/cats/LICENSE.md`，机器可读元数据写在 `public/mock-images/cats/metadata.json`。

OpenAI 和 OpenAI compatible 返回 Image API 结构：

```json
{
  "created": 1777280000,
  "data": [
    {
      "url": "http://127.0.0.1:38322/mock-images/cats/cat-17.jpg"
    }
  ]
}
```

Gemini 返回 `generateContent` 结构：

```json
{
  "candidates": [
    {
      "content": {
        "role": "model",
        "parts": [
          { "text": "Mock image generated." },
          {
            "inlineData": {
              "mimeType": "image/jpeg",
                "data": "..."
            }
          }
        ]
      },
      "finishReason": "STOP"
    }
  ]
}
```

Qwen-Image 返回 DashScope 多模态同步结构：

```json
{
  "request_id": "...",
  "output": {
    "choices": [
      {
        "finish_reason": "stop",
        "message": {
          "role": "assistant",
          "content": [
            {
              "image": "http://127.0.0.1:38322/mock-images/cats/cat-08.jpg"
            }
          ]
        }
      }
    ]
  }
}
```

Kling 返回 DashScope 异步任务结构。创建任务后前端会读取 `task_id`，再请求 `GET /api/v1/tasks/{task_id}`：

```json
{
  "request_id": "...",
  "output": {
    "task_id": "mock-kling-...",
    "task_status": "PENDING"
  }
}
```

任务结果：

```json
{
  "request_id": "...",
  "output": {
    "task_status": "SUCCEEDED",
    "results": [
      {
        "url": "http://127.0.0.1:38322/mock-images/cats/cat-12.jpg"
      }
    ]
  }
}
```

Seedream 返回 ModelArk 图像生成的 OpenAI 风格结构：

```json
{
  "created": 1777280000,
  "data": [
    {
      "url": "http://127.0.0.1:38322/mock-images/cats/cat-04.jpg"
    }
  ]
}
```

## 错误结构

OpenAI、Seedream、OpenAI compatible 使用 OpenAI 风格错误：

```json
{
  "error": {
    "message": "Incorrect API key provided.",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_api_key"
  }
}
```

Gemini 使用 Google RPC 风格错误：

```json
{
  "error": {
    "code": 401,
    "message": "API key not valid. Please pass a valid API key.",
    "status": "UNAUTHENTICATED"
  }
}
```

Qwen-Image 和 Kling 使用 DashScope 风格错误：

```json
{
  "request_id": "...",
  "code": "InvalidApiKey",
  "message": "Invalid API-key provided."
}
```

## 快速测试

OpenAI good case：

```bash
curl -s http://127.0.0.1:38322/v1/images/generations \
  -H "Authorization: Bearer mock-good-openai" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"test","n":1,"size":"1024x1024"}'
```

Gemini bad case：

```bash
curl -s http://127.0.0.1:38322/v1beta/models/gemini-3-pro-image-preview:generateContent \
  -H "x-goog-api-key: mock-bad-key" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"test"}]}]}'
```

Kling good case：

```bash
curl -s http://127.0.0.1:38322/api/v1/services/aigc/multimodal-generation/generation \
  -H "Authorization: Bearer mock-good-kling" \
  -H "Content-Type: application/json" \
  -d '{"model":"kling/kling-v3-omni-image-generation","input":{"messages":[{"role":"user","content":[{"text":"test"}]}]},"parameters":{"n":1}}'
```

## 调研来源

- OpenAI Image API and image generation guide: https://platform.openai.com/docs/guides/image-generation
- OpenAI GPT Image model page: https://developers.openai.com/api/docs/models/gpt-image-2
- Google Gemini image generation: https://ai.google.dev/gemini-api/docs/image-generation
- Google Gemini API error format: https://ai.google.dev/gemini-api/docs/troubleshooting
- Alibaba Cloud Qwen image edit API: https://www.alibabacloud.com/help/en/model-studio/qwen-image-edit-guide
- BytePlus Seedream model page: https://docs.byteplus.com/en/docs/modelark/1824718
- BytePlus Image Generation API: https://docs.byteplus.com/en/docs/ModelArk/1541523
- Adobe UXP manifest and permissions: https://developer.adobe.com/photoshop/uxp/2022/guides/uxp_guide/uxp-misc/manifest-v5/
