# 主流生图模型 API 规格参考

更新时间：2026-05-06

本文件记录主流图像生成/编辑模型的 API 形态、参考图上限、输出尺寸、调用方式和接入注意事项。优先采官方文档；官方公开文档不完整时，会标明来源边界。

## 快速对照

| 系列 | 推荐模型/接口 | 参考图上限 | 输出数量 | 输出尺寸/分辨率 | API 形态 | 来源可信度 |
| --- | --- | ---: | ---: | --- | --- | --- |
| Seedream 字节系 | `seedream-4-0-250828` | 10 张 | 单图；图组最高受总量限制 | 1K 到 4K，像素范围 `1280x720` 到 `4096x4096` | BytePlus ModelArk Image Generation API | 官方 |
| Kling 可灵/快手系 | `kling/kling-v3-image-generation`、`kling/kling-v3-omni-image-generation` | 参考图 + 主体总数不超过 10 | 单图 1-9；组图 2-9 | `1k`、`2k`，Omni 支持 `4k` | 阿里云百炼代理的可灵 API | 准官方/平台托管 |
| Qwen-Image 阿里系 | `qwen-image-2.0-pro` 文生图 | 文生图无参考图 | 1-6 张 | 总像素 `512*512` 到 `2048*2048` | DashScope / 百炼 multimodal generation | 官方 |
| Qwen-Image Edit 阿里系 | `qwen-image-2.0-pro`、`qwen-image-edit-max`、`qwen-image-edit-plus` | 1-3 张 | 1-6 张；旧 `qwen-image-edit` 固定 1 张 | 2.0 总像素 `512*512` 到 `2048*2048`；edit max/plus 宽高 `[512,2048]` | DashScope / 百炼 multimodal generation | 官方 |
| OpenAI | `gpt-image-2` | 多图编辑已支持；按 GPT Image edit 接口保守按 16 张设计 | 1-10 张 | `auto`、`1024x1024`、`1536x1024`、`1024x1536` | `/v1/images/generations`、`/v1/images/edits` | 官方 |
| Codex Image Server | `gpt-image-2` | 可随请求附带参考图 | 1 张 | `auto`、`4k` + `landscape`/`portrait`/`square` | 本机 `POST /v1/images/generate` | 本地约定 |
| Gemini / Nano Banana | `gemini-2.5-flash-image` | 3 张 | 最多 10 张 | 固定约 1024px 档，多种比例 | `models/{model}:generateContent` | 官方 |
| Gemini / Nano Banana 2 | `gemini-3.1-flash-image-preview` | 14 张 | 受输出 token 限制 | 1K/2K/4K，多种比例 | `models/{model}:generateContent` | 官方 |
| Gemini / Nano Banana Pro | `gemini-3-pro-image-preview` | 14 张 | 受输出 token 限制 | 最高 4K | `models/{model}:generateContent` | 官方 |
| FLUX.2 / BFL | `flux-2-pro-preview`、`flux-2-pro`、`flux-2-max`、`flux-2-flex` | API 8 张；`klein` 4 张；playground 10 张 | 通常单图 | 最高 4MP | `https://api.bfl.ai/v1/{model}` + polling | 官方 |
| Midjourney | 无官方 public API | 无官方规格 | 无官方规格 | 无官方规格 | 仅 Web/Discord 产品；第三方 API 风险高 | 无官方 API |

## 统一接入建议

抽象统一请求结构时，建议先用下面这组字段：

```ts
type ImageProvider = 'openai' | 'gemini' | 'seedream' | 'qwen' | 'kling' | 'flux' | 'codex-image-server'

type ImageGenerationRequest = {
  provider: ImageProvider
  model: string
  prompt: string
  negativePrompt?: string
  referenceImages?: Array<{
    url?: string
    base64?: string
    mimeType?: string
    role?: 'base' | 'reference' | 'style' | 'character' | 'mask'
  }>
  size?: string
  aspectRatio?: string
  quality?: 'low' | 'medium' | 'high' | 'auto'
  outputFormat?: 'png' | 'jpeg' | 'webp'
  seed?: number
  count?: number
  mode?: 'text-to-image' | 'image-edit' | 'image-to-image' | 'series'
}
```

关键差异：

- OpenAI 使用 multipart `image` 传一张或多张参考图。
- Gemini 使用 `contents[].parts[]`，图片以 `inline_data` 或 file data 进入同一消息。
- Qwen 和 Kling 的百炼接口使用 `input.messages[0].content[]`，图片对象是 `{"image": "url-or-base64"}`。
- BFL 使用 `input_image`、`input_image_2`、`input_image_3` 这样的编号字段。
- Seedream 在 ModelArk 中是图像生成 API 模型，规格更接近“文本 + 单图/多图输入 + 图组控制”。
- Codex Image Server 生成后返回本机文件 URL，前端读取图片并转成可展示资源；参考图作为 `references` 可选字段随生成请求发送。

## OpenAI GPT Image 2

### Endpoint

Text to image:

```http
POST https://api.openai.com/v1/images/generations
Authorization: Bearer $OPENAI_API_KEY
Content-Type: application/json
```

Image edit / reference images:

```http
POST https://api.openai.com/v1/images/edits
Authorization: Bearer $OPENAI_API_KEY
Content-Type: multipart/form-data
```

### Text to image 请求

```json
{
  "model": "gpt-image-2",
  "prompt": "A product poster with precise Chinese and English typography",
  "size": "1536x1024",
  "quality": "high",
  "output_format": "png"
}
```

### 多参考图编辑请求

```bash
curl -s -X POST "https://api.openai.com/v1/images/edits" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F "model=gpt-image-2" \
  -F "image[]=@body-lotion.png" \
  -F "image[]=@bath-bomb.png" \
  -F "image[]=@incense-kit.png" \
  -F "image[]=@soap.png" \
  -F 'prompt=Generate a photorealistic gift basket containing all items in the reference pictures'
```

### 规格

| 项 | 规格 |
| --- | --- |
| 输入 | 文本、图片 |
| 输出 | 图片，Image API 返回 base64 |
| 参考图 | 官方 guide 明确展示 `gpt-image-2` 多图编辑；OpenAI Image edit 接口对 GPT image models 的数组输入上限按 16 张设计 |
| mask | 多图输入时 mask 作用在第一张图 |
| input fidelity | `gpt-image-2` 自动高保真处理输入图，不允许手动设置 `input_fidelity` |
| 尺寸 | Image API 公开枚举使用 `auto`、`1024x1024`、`1536x1024`、`1024x1536` |
| 质量 | `low`、`medium`、`high`、`auto` |
| 格式 | `png`、`jpeg`、`webp` |
| 透明背景 | `gpt-image-2` 当前不支持 `background: "transparent"` |

### 接入注意

GPT Image 2 的 reference image 会产生输入图 token 成本。多参考图场景需要在产品层限制图片数量、尺寸和压缩策略。

来源：

- OpenAI GPT Image 2 model page: https://developers.openai.com/api/docs/models/gpt-image-2
- OpenAI Image generation guide: https://developers.openai.com/api/docs/guides/image-generation
- OpenAI Image API reference: https://platform.openai.com/docs/api-reference/images/create-edit

## Google Gemini / Nano Banana

### Endpoint

```http
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
x-goog-api-key: $GEMINI_API_KEY
Content-Type: application/json
```

常用模型：

- `gemini-3.1-flash-image-preview`：Nano Banana 2
- `gemini-3-pro-image-preview`：Nano Banana Pro
- `gemini-2.5-flash-image`：Nano Banana

### 请求格式

```json
{
  "contents": [
    {
      "parts": [
        {
          "text": "Create a product hero image using the uploaded product as the central object"
        },
        {
          "inline_data": {
            "mime_type": "image/png",
            "data": "<BASE64_IMAGE_DATA>"
          }
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "16:9"
    }
  }
}
```

### 规格

| 模型 | 参考图上限 | 文件限制 | 输出 |
| --- | ---: | --- | --- |
| `gemini-2.5-flash-image` | 3 张 | inline / console 7MB；GCS 30MB | 最多 10 张；约 1024px 档 |
| `gemini-3.1-flash-image-preview` | 14 张 | inline / console 7MB；GCS 30MB | 1K/2K/4K |
| `gemini-3-pro-image-preview` | 14 张 | inline / console 7MB；GCS 30MB | 1K/2K/4K |

支持格式：

- PNG
- JPEG
- WEBP
- HEIC
- HEIF

### 接入注意

Gemini 的图像生成和编辑都是对话式 `generateContent`。多轮编辑建议走 chat/session，而不是每一步重新发完整上下文。

来源：

- Gemini image generation: https://ai.google.dev/gemini-api/docs/image-generation
- Vertex AI image understanding limits: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-understanding

## ByteDance / Seedream

### 推荐模型

当前可查到的 BytePlus 官方页重点是 `seedream-4.0`，模型版本为：

```text
seedream-4-0-250828
```

### 能力

| 项 | 规格 |
| --- | --- |
| 输入 | 文本、单图、多图 |
| 输出 | 图片 |
| 输出格式 | JPEG |
| 输出分辨率 | 1K 到 4K |
| 输出像素范围 | `1280x720` 到 `4096x4096` |
| 参考图 | 多图输入 2-10 张 |
| 图组模式 | 多图 + 文本时，参考图数量 + 最终输出图数量不超过 15 |
| 单图转图组 | 单张参考图最多生成 14 张 |
| 纯文本图组 | 最多 15 张 |
| 限流 | 500 IPM |

### API 形态

BytePlus 文档把 Seedream 放在 ModelArk Image Generation API 下。该页的 API 参数内容需要登录/JS 才能完整显示；公开模型页提供了关键模型限制，正式接入时需要在 ModelArk 控制台确认当前地域的 Base URL、鉴权、模型 ID 和请求体参数。

建议封装层按下面的语义建模：

```json
{
  "model": "seedream-4-0-250828",
  "prompt": "Use image 1 as the product and image 2 as the style reference",
  "images": [
    "https://example.com/product.png",
    "https://example.com/style.png"
  ],
  "sequential_image_generation": "disabled",
  "size": "2048x2048"
}
```

### 接入注意

Seedream 的优势在多图融合和图组生成。产品侧需要显式区分“生成单图”和“生成一组图”，因为两种模式下输出数量约束不同。

来源：

- BytePlus Seedream 4.0 model page: https://docs.byteplus.com/en/docs/modelark/1824718
- BytePlus Image generation API page: https://docs.byteplus.com/en/docs/ModelArk/1541523
- BytePlus Seedream product page: https://www.byteplus.com/product/Seedream
- Volcengine Seedream API page: https://www.volcengine.com/docs/82379/1541523?lang=zh

## Alibaba / Qwen-Image

### Endpoint

```http
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
Authorization: Bearer $DASHSCOPE_API_KEY
Content-Type: application/json
```

北京和新加坡地域的 API Key 不通用。新加坡地域使用：

```text
https://dashscope-intl.aliyuncs.com/api/v1
```

### 文生图请求

```json
{
  "model": "qwen-image-2.0-pro",
  "input": {
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "text": "A clean ecommerce poster with accurate Chinese text"
          }
        ]
      }
    ]
  },
  "parameters": {
    "size": "2048*2048",
    "n": 1,
    "prompt_extend": true,
    "watermark": false,
    "negative_prompt": "低分辨率，文字模糊，构图混乱"
  }
}
```

### 图像编辑请求

```json
{
  "model": "qwen-image-2.0-pro",
  "input": {
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "image": "https://example.com/person.webp"
          },
          {
            "image": "https://example.com/clothes.webp"
          },
          {
            "text": "让图 1 中的人穿上图 2 的衣服，保持人物发型和表情不变"
          }
        ]
      }
    ]
  },
  "parameters": {
    "n": 1,
    "size": "2048*2048",
    "prompt_extend": true,
    "watermark": false
  }
}
```

### 规格

| 场景 | 规格 |
| --- | --- |
| 文生图参考图 | 不传参考图，只传一个 `text` |
| 图像编辑参考图 | 1-3 张，URL 或 Base64 |
| 多图规则 | 按 `content` 数组顺序定义，输出比例以最后一张为准 |
| 输入图格式 | JPG、JPEG、PNG、BMP、TIFF、WEBP、GIF；GIF 只处理第一帧 |
| 输入图尺寸 | 建议宽高 384 到 3072 像素 |
| 输入图大小 | 不超过 10MB |
| 文生图输出数量 | `qwen-image-2.0`、`qwen-image-2.0-pro` 系列 1-6；`qwen-image-max/plus` 固定 1 |
| 编辑输出数量 | `qwen-image-2.0`、`edit-max`、`edit-plus` 1-6；旧 `qwen-image-edit` 固定 1 |
| 文生图输出尺寸 | `qwen-image-2.0` 总像素 `512*512` 到 `2048*2048` |
| 编辑输出尺寸 | `qwen-image-2.0` 总像素 `512*512` 到 `2048*2048`；`edit-max/plus` 宽高 `[512,2048]` |
| 输出格式 | PNG |
| URL 有效期 | 24 小时 |

### 接入注意

Qwen 的 `content` 中只能有一个 `text`。文生图和图像编辑虽然共用 multimodal generation endpoint，但可接受的内容结构不同，封装时要分开校验。

来源：

- Qwen-Image 文生图 API: https://help.aliyun.com/zh/model-studio/qwen-image-api
- Qwen-Image-Edit API: https://help.aliyun.com/zh/model-studio/qwen-image-edit-api

## Kling / 可灵

### Endpoint

阿里云百炼托管的可灵图像生成接口：

```http
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation
Authorization: Bearer $DASHSCOPE_API_KEY
X-DashScope-Async: enable
Content-Type: application/json
```

可选模型：

```text
kling/kling-v3-image-generation
kling/kling-v3-omni-image-generation
```

### 请求格式

```json
{
  "model": "kling/kling-v3-omni-image-generation",
  "input": {
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "text": "参考图 1 的风格和图 2 的背景，生成一张番茄炒蛋海报"
          },
          {
            "image": "https://cdn.example.com/style.png"
          },
          {
            "image": "https://cdn.example.com/background.webp"
          }
        ]
      }
    ]
  },
  "parameters": {
    "n": 4,
    "result_type": "single",
    "aspect_ratio": "1:1",
    "resolution": "1k",
    "watermark": false
  }
}
```

### 规格

| 项 | 规格 |
| --- | --- |
| prompt 长度 | 2500 字符以内 |
| text 数量 | 仅支持一个 `text` |
| 参考图 | `image` URL，支持多张 |
| 参考图 + 主体 | 参考图片数量和 `element_list` 数组长度之和不超过 10；V3 基础模型按单参考图设计，V3 Omni 才使用多参考图能力 |
| 输入图格式 | JPEG、JPG、PNG；不支持透明通道 |
| 输入图尺寸 | 宽高 `[300,8000]` 像素 |
| 输入图比例 | 1:2.5 到 2.5:1 |
| 输入图大小 | 不超过 10MB |
| 单图数量 | 1-9 |
| 组图数量 | Omni 的 `series` 模式 2-9，默认 4 |
| 分辨率 | V3 支持 `1k`、`2k`；V3 Omni 支持 `1k`、`2k`、`4k` |
| 比例 | `16:9`、`9:16`、`1:1` |
| 输出格式 | PNG URL |
| URL 有效期 | 30 天 |

### 接入注意

可灵官方公开 API 文档入口相对分散。当前最完整的结构化图像 API 说明来自阿里云百炼的可灵模型 API reference；快手公告也确认可灵图像 O1 可上传最多 10 张参考图。生产接入时要确认你走的是快手官方、阿里云百炼，还是第三方聚合平台，因为 endpoint、鉴权和返回结构会不同。

来源：

- 阿里云百炼可灵图像生成 API: https://help.aliyun.com/zh/model-studio/kling-image-generation-api-reference
- 快手公告： https://ir.kuaishou.com/zh-hans/node/11101/pdf

## Black Forest Labs / FLUX.2

### Endpoint

```http
POST https://api.bfl.ai/v1/flux-2-pro-preview
x-key: $BFL_API_KEY
Content-Type: application/json
```

可用端点：

- `/v1/flux-2-max`
- `/v1/flux-2-pro-preview`
- `/v1/flux-2-pro`
- `/v1/flux-2-flex`
- `/v1/flux-2-klein-4b`
- `/v1/flux-2-klein-9b-preview`
- `/v1/flux-2-klein-9b`

### 请求格式

```json
{
  "prompt": "The person from image 1 is petting the cat from image 2",
  "input_image": "https://example.com/person.jpg",
  "input_image_2": "https://example.com/cat.jpg",
  "width": 1536,
  "height": 1024,
  "seed": 42,
  "output_format": "jpeg"
}
```

创建请求返回：

```json
{
  "id": "task-id",
  "polling_url": "https://api.bfl.ai/v1/get_result?id=task-id",
  "cost": 4.5,
  "input_mp": 2.07,
  "output_mp": 2.07
}
```

随后轮询 `polling_url` 获取结果。

### 规格

| 模型 | API 参考图上限 | Playground 上限 |
| --- | ---: | ---: |
| FLUX.2 max | 8 | 10 |
| FLUX.2 pro | 8 | 10 |
| FLUX.2 flex | 8 | 10 |
| FLUX.2 klein | 4 | 未按 10 设计 |
| FLUX.2 dev | 推荐最多 6，受本地显存影响 | 不适用 |

图像约束：

- 输入图支持 URL 或 Base64。
- 主图字段是 `input_image`，额外参考图是 `input_image_2` 到 `input_image_8`。
- 文生图和编辑都用 `width`、`height` 控制输出尺寸；产品层应提供明确像素尺寸，不要把 `1MP`、`2MP` 当作 API 参数。
- 单张输入图最大 20MB 或 20MP。
- 编辑输出默认匹配输入图尺寸并对齐到 16 的倍数。
- 输出最高 4MP，建议最高 2MP。
- 结果 signed URL 有效期 10 分钟。

来源：

- FLUX.2 overview: https://docs.bfl.ai/flux_2
- FLUX.2 image editing: https://docs.bfl.ai/flux_2/flux2_image_editing

## Midjourney

Midjourney 目前没有官方 public API。市面上的 Midjourney API 多为非官方 Discord/Web 自动化封装，存在账号、合规和稳定性风险。产品级接入建议使用具备官方 API 的模型。

来源：

- Midjourney documentation: https://docs.midjourney.com/
- Midjourney product entry: https://www.midjourney.com/

## 设计一个 Provider Adapter 时的校验规则

### 参考图数量

```ts
const referenceImageLimits = {
  'openai:gpt-image-2': 16,
  'google:gemini-2.5-flash-image': 3,
  'google:gemini-3.1-flash-image-preview': 14,
  'google:gemini-3-pro-image-preview': 14,
  'bytedance:seedream-4.0': 10,
  'alibaba:qwen-image-edit': 3,
  'kuaishou:kling-v3': 10,
  'bfl:flux-2-pro': 8,
  'bfl:flux-2-klein': 4
} as const
```

### 请求模式

```ts
type ProviderWireFormat =
  | 'openai-images-json'
  | 'openai-images-multipart'
  | 'gemini-generate-content'
  | 'dashscope-multimodal-message'
  | 'bfl-numbered-input-image'
  | 'modelark-image-generation'
```

### 输出 URL 保存

各家输出 URL 有效期不同：

- Qwen：24 小时。
- Kling via 百炼：30 天。
- BFL：10 分钟。
- OpenAI：Image API 返回 base64，调用方自己保存。
- Gemini：通常返回 inline image data，调用方自己保存。

产品侧不要把供应商临时 URL 当作长期资产。生成成功后应立即下载到自己的对象存储。

## 源文档索引

- OpenAI GPT Image 2: https://developers.openai.com/api/docs/models/gpt-image-2
- OpenAI Image generation guide: https://developers.openai.com/api/docs/guides/image-generation
- OpenAI Image API reference: https://platform.openai.com/docs/api-reference/images/create-edit
- Gemini image generation: https://ai.google.dev/gemini-api/docs/image-generation
- Gemini models: https://ai.google.dev/gemini-api/docs/models
- Vertex AI image limits: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-understanding
- BytePlus Seedream 4.0: https://docs.byteplus.com/en/docs/modelark/1824718
- BytePlus Image generation API: https://docs.byteplus.com/en/docs/ModelArk/1541523
- Volcengine Seedream API: https://www.volcengine.com/docs/82379/1541523?lang=zh
- Qwen-Image API: https://help.aliyun.com/zh/model-studio/qwen-image-api
- Qwen-Image-Edit API: https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
- Kling image generation via Model Studio: https://help.aliyun.com/zh/model-studio/kling-image-generation-api-reference
- Kuaishou Kling announcement: https://ir.kuaishou.com/zh-hans/node/11101/pdf
- FLUX.2 overview: https://docs.bfl.ai/flux_2
- FLUX.2 image editing: https://docs.bfl.ai/flux_2/flux2_image_editing
