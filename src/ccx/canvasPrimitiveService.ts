import {
  captureSelectionComposite,
  captureSelectedLayer,
  captureVisibleComposite,
  createSampleCanvasImage,
  insertCapturedImage,
  insertPreviewImage,
  readDocumentSize,
  readSelectionBounds,
  type CapturedCanvasImage
} from './canvasPrimitives'
import type { CcxDiagnosticTrace } from './diagnosticTrace'

export type CanvasInsertTarget = {
  left: number
  top: number
  width: number
  height: number
}

export type CanvasSize = {
  width: number
  height: number
}

export interface CanvasPrimitiveService {
  captureVisibleImage: (trace?: CcxDiagnosticTrace) => Promise<CapturedCanvasImage>
  captureVisibleReferenceImage: (trace?: CcxDiagnosticTrace) => Promise<CapturedCanvasImage>
  captureSelectionImage: (trace?: CcxDiagnosticTrace) => Promise<CapturedCanvasImage>
  captureSelectionReferenceImage: (trace?: CcxDiagnosticTrace) => Promise<CapturedCanvasImage>
  captureSelectedLayerImage: () => Promise<CapturedCanvasImage>
  captureSelectedLayerReferenceImage: () => Promise<CapturedCanvasImage>
  createSampleImage: () => CapturedCanvasImage
  insertImage: (image: CapturedCanvasImage, target: CanvasInsertTarget) => Promise<CanvasInsertTarget>
  insertImageFromPreview: (image: CapturedCanvasImage, target: CanvasInsertTarget, expectedDocumentId?: string) => Promise<CanvasInsertTarget>
  insertImageFromPreviewToFullCanvas: (image: CapturedCanvasImage) => Promise<CanvasInsertTarget>
  insertImageFromPreviewToSelection: (image: CapturedCanvasImage, trace?: CcxDiagnosticTrace) => Promise<CanvasInsertTarget>
  insertImageToFullCanvas: (image: CapturedCanvasImage) => Promise<CanvasInsertTarget>
  insertImageToSelection: (image: CapturedCanvasImage) => Promise<CanvasInsertTarget>
  readCanvasSize: () => CanvasSize
  readSelectionTarget: (trace?: CcxDiagnosticTrace) => Promise<CanvasInsertTarget>
}

export class PhotoshopCanvasPrimitiveService implements CanvasPrimitiveService {
  async captureVisibleImage(trace?: CcxDiagnosticTrace) {
    return captureVisibleComposite(trace)
  }

  async captureVisibleReferenceImage(trace?: CcxDiagnosticTrace) {
    const image = await this.captureVisibleImage(trace)
    return {
      ...image,
      rgba: new Uint8Array()
    }
  }

  async captureSelectionImage(trace?: CcxDiagnosticTrace) {
    return captureSelectionComposite(trace)
  }

  async captureSelectionReferenceImage(trace?: CcxDiagnosticTrace) {
    const image = await this.captureSelectionImage(trace)
    return {
      ...image,
      rgba: new Uint8Array()
    }
  }

  async captureSelectedLayerImage() {
    return captureSelectedLayer()
  }

  async captureSelectedLayerReferenceImage() {
    const image = await this.captureSelectedLayerImage()
    return {
      ...image,
      rgba: new Uint8Array()
    }
  }

  createSampleImage() {
    return createSampleCanvasImage()
  }

  async insertImage(image: CapturedCanvasImage, target: CanvasInsertTarget) {
    return insertCapturedImage(image, target)
  }

  async insertImageFromPreview(image: CapturedCanvasImage, target: CanvasInsertTarget, expectedDocumentId?: string) {
    return insertPreviewImage(image, target, expectedDocumentId)
  }

  async insertImageFromPreviewToFullCanvas(image: CapturedCanvasImage) {
    const size = this.readCanvasSize()

    return this.insertImageFromPreview(image, {
      left: 0,
      top: 0,
      width: size.width,
      height: size.height
    })
  }

  async insertImageFromPreviewToSelection(image: CapturedCanvasImage, trace?: CcxDiagnosticTrace) {
    const target = await this.readSelectionTarget(trace)

    return this.insertImageFromPreview(image, target)
  }

  async insertImageToFullCanvas(image: CapturedCanvasImage) {
    const size = this.readCanvasSize()

    return this.insertImage(image, {
      left: 0,
      top: 0,
      width: size.width,
      height: size.height
    })
  }

  async insertImageToSelection(image: CapturedCanvasImage) {
    const target = await this.readSelectionTarget()

    return this.insertImage(image, target)
  }

  readCanvasSize() {
    return readDocumentSize()
  }

  async readSelectionTarget(trace?: CcxDiagnosticTrace) {
    return readSelectionBounds(trace)
  }
}

export const canvasPrimitiveService = new PhotoshopCanvasPrimitiveService()
