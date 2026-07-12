import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { basename, dirname, join, resolve, win32 } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const DOWNLOAD_ORIGIN = "https://cake.catrefuse.com"
const UPDATE_CHECK_URL = `${DOWNLOAD_ORIGIN}/releases/latest.json`
const rootFromScript = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))

function fail(message) {
  throw new Error(`release gate: ${message}`)
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n")
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function sha256File(path) {
  return await new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256")
    const input = createReadStream(path)
    input.on("error", rejectHash)
    input.on("data", (chunk) => hash.update(chunk))
    input.on("end", () => resolveHash(hash.digest("hex")))
  })
}

function parseChecksums(contents, expectedFilenames) {
  const lines = normalizeNewlines(contents)
    .split("\n")
    .filter((line) => line.length > 0)

  if (lines.length !== expectedFilenames.length) {
    fail(`SHA256SUMS.txt must contain exactly ${expectedFilenames.length} non-empty entries`)
  }

  const checksums = new Map()
  for (const line of lines) {
    const match = /^([a-fA-F0-9]{64})[ \t]+\*?(.+)$/.exec(line)
    if (!match) {
      fail(`invalid SHA256SUMS.txt entry: ${JSON.stringify(line)}`)
    }

    const filename = match[2]
    if (
      filename !== basename(filename) ||
      filename !== win32.basename(filename) ||
      filename === "." ||
      filename === ".."
    ) {
      fail(`SHA256SUMS.txt entries must use basenames only: ${JSON.stringify(filename)}`)
    }
    if (!expectedFilenames.includes(filename)) {
      fail(`unexpected SHA256SUMS.txt filename: ${JSON.stringify(filename)}`)
    }
    if (checksums.has(filename)) {
      fail(`duplicate SHA256SUMS.txt filename: ${JSON.stringify(filename)}`)
    }
    checksums.set(filename, match[1].toLowerCase())
  }

  for (const filename of expectedFilenames) {
    if (!checksums.has(filename)) {
      fail(`SHA256SUMS.txt is missing ${filename}`)
    }
  }

  return checksums
}

function expectedArtifactFilenames(version) {
  return {
    mac: `lightyear-banana-${version}-mac.zip`,
    windows: `lightyear-banana-${version}-win.zip`,
    ccx: `lightyear-banana-${version}.ccx`
  }
}

export async function verifyReleaseBundle({ root = rootFromScript, version } = {}) {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  const releaseVersion = version ?? packageJson.version
  requireEqual(packageJson.version, releaseVersion, "package.json version")

  const releaseDir = join(root, "dist", `release-${releaseVersion}`)
  const filenames = expectedArtifactFilenames(releaseVersion)
  const expectedFilenames = Object.values(filenames)
  const checksumPath = join(releaseDir, "SHA256SUMS.txt")

  let checksumContents
  try {
    checksumContents = await readFile(checksumPath, "utf8")
  } catch (error) {
    fail(`cannot read ${checksumPath}: ${error.message}`)
  }
  const listedChecksums = parseChecksums(checksumContents, expectedFilenames)

  const artifacts = {}
  for (const [key, filename] of Object.entries(filenames)) {
    const path = join(releaseDir, filename)
    let fileStats
    try {
      fileStats = await stat(path)
    } catch (error) {
      fail(`cannot read ${path}: ${error.message}`)
    }
    if (!fileStats.isFile() || fileStats.size <= 0) {
      fail(`${path} must be a non-empty file`)
    }

    const sha256 = await sha256File(path)
    requireEqual(listedChecksums.get(filename), sha256, `SHA256 for ${filename}`)
    artifacts[key] = { filename, path, sha256, size: fileStats.size }
  }

  return {
    version: releaseVersion,
    releaseDir,
    checksumPath,
    artifacts
  }
}

function findAnchor(html, attribute, value) {
  const expectedAttribute = value
    ? `${escapeRegExp(attribute)}=["']${escapeRegExp(value)}["']`
    : `${escapeRegExp(attribute)}(?:=["'][^"']*["'])?`
  const match = new RegExp(
    `<a\\b(?=[^>]*\\b${expectedAttribute})[^>]*>[\\s\\S]*?<\\/a>`,
    "i"
  ).exec(html)
  if (!match) {
    fail(`site/index.html is missing an anchor with ${attribute}${value ? `=${value}` : ""}`)
  }
  return match[0]
}

function readHref(anchor, label) {
  const match = /\bhref=["']([^"']+)["']/i.exec(anchor)
  if (!match) {
    fail(`${label} is missing href`)
  }
  return match[1]
}

function readClassText(anchor, className, label) {
  const match = new RegExp(
    `<[^>]+class=["'][^"']*\\b${escapeRegExp(className)}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "i"
  ).exec(anchor)
  if (!match) {
    fail(`${label} is missing .${className}`)
  }
  return match[1].replace(/<[^>]*>/g, "").trim()
}

function formatBytes(size) {
  const units = ["B", "KB", "MB", "GB"]
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

function readLabeledValue(text, label) {
  const match = new RegExp(`^${escapeRegExp(label)}[ \\t]*(.+)$`, "m").exec(text)
  if (!match) {
    fail(`llms.txt is missing ${label.trim()}`)
  }
  return match[1].trim()
}

function readFollowingLine(text, label) {
  const match = new RegExp(`^${escapeRegExp(label)}[ \\t]*\\n([^\\n]+)$`, "m").exec(text)
  if (!match) {
    fail(`llms.txt is missing the value after ${label}`)
  }
  return match[1].trim()
}

function readDownloadBlock(text, heading) {
  const match = new RegExp(
    `^${escapeRegExp(heading)}[ \\t]*\\n([^\\n]+)\\nsha256:[ \\t]*([a-fA-F0-9]{64})\\nsize:[ \\t]*(\\d+)[ \\t]+bytes$`,
    "m"
  ).exec(text)
  if (!match) {
    fail(`llms.txt has an invalid ${heading} block`)
  }
  return { url: match[1].trim(), sha256: match[2], size: Number(match[3]) }
}

export async function verifySiteMetadata({
  root = rootFromScript,
  siteDir = join(root, "site"),
  bundle
} = {}) {
  const verifiedBundle = bundle ?? await verifyReleaseBundle({ root })
  const { version, artifacts } = verifiedBundle
  const latestPath = join(siteDir, "releases", "latest.json")
  const latest = JSON.parse(await readFile(latestPath, "utf8"))
  const releaseBaseUrl = `${DOWNLOAD_ORIGIN}/releases/${version}`
  const expectedReleaseUrl = `${releaseBaseUrl}/SHA256SUMS.txt`

  requireObject(latest, "site/releases/latest.json")
  requireEqual(latest.version, version, "latest.json version")
  requireEqual(latest.tag, `v${version}`, "latest.json tag")
  requireEqual(latest.releaseUrl, expectedReleaseUrl, "latest.json releaseUrl")
  requireEqual(latest.updateCheckUrl, UPDATE_CHECK_URL, "latest.json updateCheckUrl")
  requireObject(latest.downloads, "latest.json downloads")

  for (const key of ["mac", "windows", "ccx"]) {
    const artifact = artifacts[key]
    const download = latest.downloads[key]
    requireObject(download, `latest.json downloads.${key}`)
    requireEqual(download.filename, artifact.filename, `latest.json downloads.${key}.filename`)
    requireEqual(download.url, `${releaseBaseUrl}/${artifact.filename}`, `latest.json downloads.${key}.url`)
    requireEqual(download.sha256, artifact.sha256, `latest.json downloads.${key}.sha256`)
    requireEqual(download.size, artifact.size, `latest.json downloads.${key}.size`)
  }

  const html = await readFile(join(siteDir, "index.html"), "utf8")
  for (const [key, dataDownload] of [["mac", "mac"], ["windows", "win"], ["ccx", "ccx"]]) {
    const artifact = artifacts[key]
    const expectedUrl = `${releaseBaseUrl}/${artifact.filename}`
    const anchor = findAnchor(html, "data-download", dataDownload)
    requireEqual(readHref(anchor, `site/index.html ${dataDownload} download`), expectedUrl, `site/index.html ${dataDownload} href`)
    requireEqual(readClassText(anchor, "download-file", `site/index.html ${dataDownload} download`), artifact.filename, `site/index.html ${dataDownload} filename`)
    requireEqual(readClassText(anchor, "download-size", `site/index.html ${dataDownload} download`), formatBytes(artifact.size), `site/index.html ${dataDownload} size`)
  }
  const releaseAnchor = findAnchor(html, "data-release-url")
  requireEqual(readHref(releaseAnchor, "site/index.html release link"), expectedReleaseUrl, "site/index.html release href")

  const llmsLowerRaw = await readFile(join(siteDir, "llms.txt"), "utf8")
  const llmsUpperRaw = await readFile(join(siteDir, "LLM.TXT"), "utf8")
  requireEqual(llmsUpperRaw, llmsLowerRaw, "site/LLM.TXT content")
  const llms = normalizeNewlines(llmsLowerRaw)

  requireEqual(readLabeledValue(llms, "Current version:"), version, "llms.txt current version")
  requireEqual(readLabeledValue(llms, "Minimum supported version:"), latest.minimumSupportedVersion, "llms.txt minimum supported version")
  requireEqual(readLabeledValue(llms, "Published at:"), latest.publishedAt, "llms.txt published at")
  requireEqual(readFollowingLine(llms, "Version check:"), `GET ${UPDATE_CHECK_URL}`, "llms.txt version check URL")
  requireEqual(readFollowingLine(llms, "Manifest:"), UPDATE_CHECK_URL, "llms.txt manifest URL")
  requireEqual(readFollowingLine(llms, "Release checksums:"), expectedReleaseUrl, "llms.txt release checksums URL")

  for (const [key, heading] of [["mac", "macOS desktop:"], ["windows", "Windows desktop:"], ["ccx", "Adobe Photoshop plugin:"]]) {
    const artifact = artifacts[key]
    const block = readDownloadBlock(llms, heading)
    requireEqual(block.url, `${releaseBaseUrl}/${artifact.filename}`, `llms.txt ${key} URL`)
    requireEqual(block.sha256, artifact.sha256, `llms.txt ${key} SHA256`)
    requireEqual(block.size, artifact.size, `llms.txt ${key} size`)
  }

  if (latest.githubUrl) {
    requireEqual(readLabeledValue(llms, "GitHub:"), latest.githubUrl, "llms.txt GitHub URL")
  }

  return { bundle: verifiedBundle, latest }
}

export async function verifyReleaseSite(options = {}) {
  const bundle = await verifyReleaseBundle(options)
  return await verifySiteMetadata({ ...options, bundle })
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  const { bundle } = await verifyReleaseSite()
  console.log(`Verified release ${bundle.version} at ${bundle.releaseDir}`)
}
