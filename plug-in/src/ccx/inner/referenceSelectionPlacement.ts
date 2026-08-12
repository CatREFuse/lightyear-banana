import type { Bounds, HostAssetRef, PlacementTarget } from '@mugen/inner-protocol'

type ReferenceSelectionTarget = Extract<PlacementTarget, { type: 'reference-selection' }>

export type TrustedReferenceSelectionPlacement = {
  bounds: { left: number; top: number; width: number; height: number }
  target: ReferenceSelectionTarget
}

function normalizeBounds(bounds: Bounds | undefined) {
  if (!bounds) throw new Error('所选参考图缺少原始选区信息，请重新抓取选区')

  const left = Number(bounds.left)
  const top = Number(bounds.top)
  const width = Number.isFinite(bounds.width) ? Number(bounds.width) : Number(bounds.right) - left
  const height = Number.isFinite(bounds.height) ? Number(bounds.height) : Number(bounds.bottom) - top

  if (
    ![left, top, width, height].every(Number.isFinite)
    || width <= 0
    || height <= 0
    || width > 100_000
    || height > 100_000
  ) {
    throw new Error('所选参考图缺少有效的原始选区信息，请重新抓取选区')
  }

  return { left, top, width, height }
}

function sameBounds(
  left: { left: number; top: number; width: number; height: number },
  right: { left: number; top: number; width: number; height: number }
) {
  return left.left === right.left
    && left.top === right.top
    && left.width === right.width
    && left.height === right.height
}

export function resolveReferenceSelectionPlacement(
  target: ReferenceSelectionTarget,
  reference: HostAssetRef,
  currentDocumentId: string | undefined
): TrustedReferenceSelectionPlacement {
  if (reference.assetId !== target.referenceAssetId) {
    throw new Error('所选参考图与置入目标不一致，请重新选择置入位置')
  }
  if (reference.status === 'missing') {
    throw new Error('资产已失效，请重新抓取选区')
  }
  if (reference.source !== 'selection') {
    throw new Error('所选参考图不是选区参考图，无法按原位置置入')
  }
  if (!reference.documentId) {
    throw new Error('所选参考图缺少原 Photoshop 文档信息，请重新抓取选区')
  }
  if (!currentDocumentId) {
    throw new Error('请先打开原 Photoshop 文档，再置入图片')
  }
  if (currentDocumentId !== reference.documentId) {
    throw new Error('当前 Photoshop 文档与参考图来源不一致，请切回原文档后重试')
  }

  const trustedBounds = normalizeBounds(reference.sourceBounds)
  let requestedBounds: ReturnType<typeof normalizeBounds>
  try {
    requestedBounds = normalizeBounds(target.bounds)
  } catch {
    throw new Error('置入范围无效，请重新选择置入位置')
  }
  if (!sameBounds(requestedBounds, trustedBounds)) {
    throw new Error('置入范围与参考图原始选区不一致，请重新选择置入位置')
  }

  return {
    bounds: trustedBounds,
    target: {
      type: 'reference-selection',
      referenceAssetId: reference.assetId,
      bounds: { ...trustedBounds }
    }
  }
}
