type AdobeUxpRequire = (name: string) => any

export function getHostRequire(): AdobeUxpRequire | null {
  const maybeRequire = (globalThis as { require?: AdobeUxpRequire }).require
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
