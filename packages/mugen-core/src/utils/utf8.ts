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
