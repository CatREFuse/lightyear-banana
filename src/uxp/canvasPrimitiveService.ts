import {
  captureSelectionComposite,
  captureSelectedLayer,
  captureSelectedLayerReference,
  captureVisibleComposite,
  captureVisibleReference,
  createSampleCanvasImage,
  insertCapturedImage,
  readDocumentSize,
  readSelectionBounds,
  type CapturedCanvasImage
} from './canvasPrimitives'

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
  captureSelectionImage: () => Promise<CapturedCanvasImage>
  captureSelectionReferenceImage: () => Promise<CapturedCanvasImage>
  captureSelectedLayerImage: () => Promise<CapturedCanvasImage>
  captureSelectedLayerReferenceImage: () => Promise<CapturedCanvasImage>
  createSampleImage: () => CapturedCanvasImage
  insertImage: (image: CapturedCanvasImage, target: CanvasInsertTarget) => Promise<CanvasInsertTarget>
  insertImageToFullCanvas: (image: CapturedCanvasImage) => Promise<CanvasInsertTarget>
  insertImageToSelection: (image: CapturedCanvasImage) => Promise<CanvasInsertTarget>
  readCanvasSize: () => CanvasSize
  readSelectionTarget: () => Promise<CanvasInsertTarget>
}

export class PhotoshopCanvasPrimitiveService implements CanvasPrimitiveService {
  async captureVisibleImage() {
    return captureVisibleComposite()
  }

  async captureVisibleReferenceImage() {
    return captureVisibleReference()
  }

  async captureSelectionImage() {
    return captureSelectionComposite()
  }

  async captureSelectionReferenceImage() {
    const image = await captureSelectionComposite()
    return {
      ...image,
      rgba: new Uint8Array()
    }
  }

  async captureSelectedLayerImage() {
    return captureSelectedLayer()
  }

  async captureSelectedLayerReferenceImage() {
    return captureSelectedLayerReference()
  }

  createSampleImage() {
    return createSampleCanvasImage()
  }

  async insertImage(image: CapturedCanvasImage, target: CanvasInsertTarget) {
    return insertCapturedImage(image, target)
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

  async readSelectionTarget() {
    return readSelectionBounds()
  }
}

export const canvasPrimitiveService = new PhotoshopCanvasPrimitiveService()
