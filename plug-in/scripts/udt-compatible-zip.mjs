import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return crc >>> 0
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function listArchiveFiles(root) {
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`CCX staging cannot contain symlinks: ${absolutePath}`)
      if (entry.isDirectory()) visit(absolutePath)
      else if (entry.isFile()) files.push(path.relative(root, absolutePath).replaceAll(path.sep, '/'))
      else throw new Error(`CCX staging contains an unsupported entry: ${absolutePath}`)
    }
  }
  visit(root)
  files.sort((left, right) => left.localeCompare(right, 'en'))
  const manifestIndex = files.indexOf('manifest.json')
  if (manifestIndex < 0) throw new Error('CCX staging must contain manifest.json at the archive root.')
  files.splice(manifestIndex, 1)
  files.unshift('manifest.json')
  return files
}

function dosTimestamp(date) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()))
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

function localHeader({ name, dosTime, dosDate }) {
  const header = Buffer.alloc(30 + name.length)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x0008, 6)
  header.writeUInt16LE(8, 8)
  header.writeUInt16LE(dosTime, 10)
  header.writeUInt16LE(dosDate, 12)
  header.writeUInt16LE(name.length, 26)
  name.copy(header, 30)
  return header
}

function dataDescriptor({ crc, compressedSize, size }) {
  const descriptor = Buffer.alloc(16)
  descriptor.writeUInt32LE(0x08074b50, 0)
  descriptor.writeUInt32LE(crc, 4)
  descriptor.writeUInt32LE(compressedSize, 8)
  descriptor.writeUInt32LE(size, 12)
  return descriptor
}

function centralHeader({ name, crc, compressedSize, size, dosTime, dosDate, offset }) {
  const header = Buffer.alloc(46 + name.length)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(0x032d, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(0x0008, 8)
  header.writeUInt16LE(8, 10)
  header.writeUInt16LE(dosTime, 12)
  header.writeUInt16LE(dosDate, 14)
  header.writeUInt32LE(crc, 16)
  header.writeUInt32LE(compressedSize, 20)
  header.writeUInt32LE(size, 24)
  header.writeUInt16LE(name.length, 28)
  header.writeUInt32LE(0x81a40020, 38)
  header.writeUInt32LE(offset, 42)
  name.copy(header, 46)
  return header
}

function endOfCentralDirectory({ entryCount, centralSize, centralOffset }) {
  const record = Buffer.alloc(22)
  record.writeUInt32LE(0x06054b50, 0)
  record.writeUInt16LE(entryCount, 8)
  record.writeUInt16LE(entryCount, 10)
  record.writeUInt32LE(centralSize, 12)
  record.writeUInt32LE(centralOffset, 16)
  return record
}

export function createUdtCompatibleZip({ sourceDirectory, archivePath, createdAt = new Date() }) {
  if (!statSync(sourceDirectory).isDirectory()) throw new Error(`CCX source is not a directory: ${sourceDirectory}`)
  const files = listArchiveFiles(sourceDirectory)
  const { time: dosTime, date: dosDate } = dosTimestamp(createdAt)
  const body = []
  const central = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file, 'utf8')
    let bytes = readFileSync(path.join(sourceDirectory, ...file.split('/')))
    if (file === 'manifest.json' && bytes.at(-1) === 0x0a) {
      bytes = bytes.subarray(0, bytes.at(-2) === 0x0d ? bytes.length - 2 : bytes.length - 1)
    }
    const compressed = deflateRawSync(bytes)
    const crc = crc32(bytes)
    const header = localHeader({ name, dosTime, dosDate })
    const descriptor = dataDescriptor({ crc, compressedSize: compressed.length, size: bytes.length })
    body.push(header, compressed, descriptor)
    central.push(centralHeader({
      name,
      crc,
      compressedSize: compressed.length,
      size: bytes.length,
      dosTime,
      dosDate,
      offset
    }))
    offset += header.length + compressed.length + descriptor.length
  }

  const centralDirectory = Buffer.concat(central)
  const archive = Buffer.concat([
    ...body,
    centralDirectory,
    endOfCentralDirectory({
      entryCount: files.length,
      centralSize: centralDirectory.length,
      centralOffset: offset
    })
  ])
  writeFileSync(archivePath, archive, { flag: 'wx' })
  return { fileCount: files.length, entries: files }
}
