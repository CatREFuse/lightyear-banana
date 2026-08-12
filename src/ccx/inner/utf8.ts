function codePointAt(value: string, index: number) {
  const first = value.charCodeAt(index)
  if (first >= 0xD800 && first <= 0xDBFF && index + 1 < value.length) {
    const second = value.charCodeAt(index + 1)
    if (second >= 0xDC00 && second <= 0xDFFF) {
      return { codePoint: 0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00), width: 2 }
    }
  }
  if (first >= 0xD800 && first <= 0xDFFF) return { codePoint: 0xFFFD, width: 1 }
  return { codePoint: first, width: 1 }
}

export function encodeUtf8(value: string) {
  const bytes: number[] = []
  for (let index = 0; index < value.length;) {
    const { codePoint, width } = codePointAt(value, index)
    index += width
    if (codePoint <= 0x7F) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7FF) {
      bytes.push(0xC0 | (codePoint >> 6), 0x80 | (codePoint & 0x3F))
    } else if (codePoint <= 0xFFFF) {
      bytes.push(0xE0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3F), 0x80 | (codePoint & 0x3F))
    } else {
      bytes.push(0xF0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3F), 0x80 | ((codePoint >> 6) & 0x3F), 0x80 | (codePoint & 0x3F))
    }
  }
  return Uint8Array.from(bytes)
}

function continuation(byte: number | undefined) {
  return byte !== undefined && (byte & 0xC0) === 0x80
}

export function decodeUtf8(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let result = ''
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index]!
    let codePoint = 0xFFFD
    let width = 1
    if (first <= 0x7F) {
      codePoint = first
    } else if (first >= 0xC2 && first <= 0xDF && continuation(bytes[index + 1])) {
      codePoint = ((first & 0x1F) << 6) | (bytes[index + 1]! & 0x3F)
      width = 2
    } else if (
      first >= 0xE0 && first <= 0xEF
      && continuation(bytes[index + 1])
      && continuation(bytes[index + 2])
    ) {
      const candidate = ((first & 0x0F) << 12) | ((bytes[index + 1]! & 0x3F) << 6) | (bytes[index + 2]! & 0x3F)
      if (candidate >= 0x800 && (candidate < 0xD800 || candidate > 0xDFFF)) {
        codePoint = candidate
        width = 3
      }
    } else if (
      first >= 0xF0 && first <= 0xF4
      && continuation(bytes[index + 1])
      && continuation(bytes[index + 2])
      && continuation(bytes[index + 3])
    ) {
      const candidate = ((first & 0x07) << 18) | ((bytes[index + 1]! & 0x3F) << 12) | ((bytes[index + 2]! & 0x3F) << 6) | (bytes[index + 3]! & 0x3F)
      if (candidate >= 0x10000 && candidate <= 0x10FFFF) {
        codePoint = candidate
        width = 4
      }
    }
    index += width
    if (codePoint <= 0xFFFF) {
      result += String.fromCharCode(codePoint)
    } else {
      const offset = codePoint - 0x10000
      result += String.fromCharCode(0xD800 + (offset >> 10), 0xDC00 + (offset & 0x3FF))
    }
  }
  return result
}

export function utf8ByteLength(value: string) {
  return encodeUtf8(value).byteLength
}
