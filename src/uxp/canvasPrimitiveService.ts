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
import type { UxpDiagnosticTrace } from './diagnosticTrace'

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
  captureVisibleImage: () => Promise<CapturedCanvasImage>
  captureVisibleReferenceImage: () => Promise<CapturedCanvasImage>
  captureSelectionImage: (trace?: UxpDiagnosticTrace) => Promise<CapturedCanvasImage>
  captureSelectionReferenceImage: (trace?: UxpDiagnosticTrace) => Promise<CapturedCanvasImage>
  captureSelectedLayerImage: () => Promise<CapturedCanvasImage>
  captureSelectedLayerReferenceImage: () => Promise<CapturedCanvasImage>
  createSampleImage: () => CapturedCanvasImage
  insertImage: (image: CapturedCanvasImage, target: CanvasInsertTarget) => Promise<CanvasInsertTarget>
  insertImageFromPreview: (image: CapturedCanvasImage, target: CanvasInsertTarget) => Promise<CanvasInsertTarget>
  insertImageFromPreviewToFullCanvas: (image: CapturedCanvasImage) => Promise<CanvasInsertTarget>
  insertImageFromPreviewToSelection: (image: CapturedCanvasImage, trace?: UxpDiagnosticTrace) => Promise<CanvasInsertTarget>
  insertImageToFullCanvas: (image: CapturedCanvasImage) => Promise<CanvasInsertTarget>
  insertImageToSelection: (image: CapturedCanvasImage) => Promise<CanvasInsertTarget>
  readCanvasSize: () => CanvasSize
  readSelectionTarget: (trace?: UxpDiagnosticTrace) => Promise<CanvasInsertTarget>
}

export class PhotoshopCanvasPrimitiveService implements CanvasPrimitiveService {
  async captureVisibleImage() {
    return captureVisibleComposite()
  }

  async captureVisibleReferenceImage() {
    const image = await this.captureVisibleImage()
    return {
      ...image,
      rgba: new Uint8Array()
    }
  }

  async captureSelectionImage(trace?: UxpDiagnosticTrace) {
    return captureSelectionComposite(trace)
  }

  async captureSelectionReferenceImage(trace?: UxpDiagnosticTrace) {
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

  async insertImageFromPreview(image: CapturedCanvasImage, target: CanvasInsertTarget) {
    return insertPreviewImage(image, target)
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

  async insertImageFromPreviewToSelection(image: CapturedCanvasImage, trace?: UxpDiagnosticTrace) {
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

  async readSelectionTarget(trace?: UxpDiagnosticTrace) {
    return readSelectionBounds(trace)
  }
}

export const canvasPrimitiveService = new PhotoshopCanvasPrimitiveService()
