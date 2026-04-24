type UxpRequire = (name: string) => any

export function getHostRequire(): UxpRequire | null {
  const maybeRequire = (globalThis as { require?: UxpRequire }).require
  return typeof maybeRequire === 'function' ? maybeRequire : null
}

export function readActiveDocumentLabel() {
  const hostRequire = getHostRequire()
  if (!hostRequire) {
    return '浏览器预览'
  }

  const photoshop = hostRequire('photoshop')
  try {
    const doc = photoshop.app.activeDocument
    return `${doc.title ?? doc.name ?? '未命名文档'} · ${Math.round(doc.width)} × ${Math.round(doc.height)}`
  } catch {
    return '没有打开文档'
  }
}

export async function createNamedLayer(name = 'Lightyear Banana') {
  const hostRequire = getHostRequire()
  if (!hostRequire) {
    throw new Error('Photoshop UXP runtime is unavailable.')
  }

  const photoshop = hostRequire('photoshop')
  await photoshop.core.executeAsModal(
    async () => {
      await photoshop.action.batchPlay(
        [
          {
            _obj: 'make',
            _target: [{ _ref: 'layer' }],
            using: {
              _obj: 'layer',
              name
            },
            _options: {
              dialogOptions: 'dontDisplay'
            }
          }
        ],
        {}
      )
    },
    { commandName: 'Create Lightyear Banana Layer' }
  )
}
