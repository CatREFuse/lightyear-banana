import {
  captureSelectionComposite,
  captureSelectedLayer,
  captureVisibleComposite,
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
  captureSelectionImage: () => Promise<CapturedCanvasImage>
  captureSelectedLayerImage: () => Promise<CapturedCanvasImage>
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

  async captureSelectionImage() {
    return captureSelectionComposite()
  }

  async captureSelectedLayerImage() {
    return captureSelectedLayer()
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
