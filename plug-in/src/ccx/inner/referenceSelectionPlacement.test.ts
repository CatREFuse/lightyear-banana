import { describe, expect, it } from 'vitest'
import type { HostAssetRef } from '@mugen/inner-protocol'
import { resolveReferenceSelectionPlacement } from './referenceSelectionPlacement'

function selectionReference(overrides: Partial<HostAssetRef> = {}): HostAssetRef {
  return {
    assetId: 'selection-1',
    label: '选区参考图',
    source: 'selection',
    mimeType: 'image/png',
    width: 320,
    height: 180,
    previewUrl: 'data:image/png;base64,AQID',
    sourceBounds: { left: 12, top: 24, right: 332, bottom: 204 },
    documentId: 'document-7',
    status: 'available',
    ...overrides
  }
}

const target = {
  type: 'reference-selection' as const,
  referenceAssetId: 'selection-1',
  bounds: { left: 12, top: 24, right: 332, bottom: 204 }
}

describe('reference-selection placement binding', () => {
  it('uses normalized bounds from the trusted Host asset', () => {
    const resolved = resolveReferenceSelectionPlacement(
      { ...target, bounds: { left: 12, top: 24, width: 320, height: 180 } },
      selectionReference(),
      'document-7'
    )

    expect(resolved.bounds).toEqual({ left: 12, top: 24, width: 320, height: 180 })
    expect(resolved.target).toEqual({
      type: 'reference-selection',
      referenceAssetId: 'selection-1',
      bounds: { left: 12, top: 24, width: 320, height: 180 }
    })
  })

  it('rejects a switched or closed Photoshop document', () => {
    expect(() => resolveReferenceSelectionPlacement(target, selectionReference(), 'document-8'))
      .toThrow('当前 Photoshop 文档与参考图来源不一致')
    expect(() => resolveReferenceSelectionPlacement(target, selectionReference(), undefined))
      .toThrow('请先打开原 Photoshop 文档')
  })

  it('rejects client bounds that differ from the captured selection', () => {
    expect(() => resolveReferenceSelectionPlacement(
      { ...target, bounds: { left: 13, top: 24, right: 333, bottom: 204 } },
      selectionReference(),
      'document-7'
    )).toThrow('置入范围与参考图原始选区不一致')
  })

  it('rejects stale, non-selection, or incomplete reference assets', () => {
    expect(() => resolveReferenceSelectionPlacement(target, selectionReference({ status: 'missing' }), 'document-7'))
      .toThrow('资产已失效')
    expect(() => resolveReferenceSelectionPlacement(target, selectionReference({ source: 'upload' }), 'document-7'))
      .toThrow('所选参考图不是选区参考图')
    expect(() => resolveReferenceSelectionPlacement(target, selectionReference({ sourceBounds: undefined }), 'document-7'))
      .toThrow('所选参考图缺少原始选区信息')
    expect(() => resolveReferenceSelectionPlacement(target, selectionReference({ documentId: undefined }), 'document-7'))
      .toThrow('所选参考图缺少原 Photoshop 文档信息')
  })

  it('rejects a reference id that does not match the trusted asset', () => {
    expect(() => resolveReferenceSelectionPlacement(target, selectionReference({ assetId: 'selection-2' }), 'document-7'))
      .toThrow('所选参考图与置入目标不一致')
  })
})
