import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { basename, dirname, join, resolve, win32 } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { assertProductionOrigin, resolveReleaseUrl } from "./production-origin-policy.mjs"

const rootFromScript = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
const RELEASE_ORIGIN_PLACEHOLDER = "__MUGEN_RELEASE_ORIGIN__"

function materializeReleaseOrigin(value, releaseOrigin) {
  return value.replaceAll(RELEASE_ORIGIN_PLACEHOLDER, releaseOrigin)
}

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

function requireSemver(value, label) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) {
    fail(`${label} must use x.y.z format`)
  }
  return value
}

export async function verifyCcxRelease({ root = rootFromScript } = {}) {
  const pluginManifest = JSON.parse(await readFile(join(root, "plugin", "manifest.json"), "utf8"))
  const ccxVersion = requireSemver(pluginManifest.version, "plugin manifest version")

  const ccxMetadataPath = join(root, "dist", "ccx-release.json")
  let ccxMetadata
  try {
    ccxMetadata = JSON.parse(await readFile(ccxMetadataPath, "utf8"))
  } catch (error) {
    fail(`cannot read ${ccxMetadataPath}: ${error.message}`)
  }
  requireObject(ccxMetadata, "dist/ccx-release.json")
  requireEqual(ccxMetadata.schemaVersion, 1, "ccx-release.json schemaVersion")
  requireEqual(ccxMetadata.ccxVersion, ccxVersion, "ccx-release.json ccxVersion")
  requireEqual(ccxMetadata.filename, `mugen-${ccxVersion}.ccx`, "ccx-release.json filename")
  requireEqual(ccxMetadata.dirty, false, "ccx-release.json dirty")
  if (typeof ccxMetadata.sourceCommit !== "string" || !/^[a-fA-F0-9]{40}$/.test(ccxMetadata.sourceCommit)) {
    fail("ccx-release.json sourceCommit must contain 40 hexadecimal characters")
  }
  if (typeof ccxMetadata.builtAt !== "string" || Number.isNaN(Date.parse(ccxMetadata.builtAt))) {
    fail("ccx-release.json builtAt must be an ISO timestamp")
  }
  if (typeof ccxMetadata.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(ccxMetadata.sha256)) {
    fail("ccx-release.json sha256 must contain 64 hexadecimal characters")
  }
  const webviewOrigin = assertProductionOrigin(ccxMetadata.webviewOrigin, "ccx-release.json webviewOrigin")
  const releaseUrl = resolveReleaseUrl({
    processEnvironment: { INNER_RELEASE_URL: ccxMetadata.releaseUrl },
    webviewOrigin,
    production: true
  }).href
  requireEqual(ccxMetadata.releaseUrl, releaseUrl, "ccx-release.json releaseUrl")

  const path = join(root, "dist", ccxMetadata.filename)
  const checksumPath = `${path}.sha256`
  let fileStats
  try {
    fileStats = await stat(path)
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`)
  }
  if (!fileStats.isFile() || fileStats.size <= 0) fail(`${path} must be a non-empty file`)

  let checksumContents
  try {
    checksumContents = await readFile(checksumPath, "utf8")
  } catch (error) {
    fail(`cannot read ${checksumPath}: ${error.message}`)
  }
  const listedChecksums = parseChecksums(checksumContents, [ccxMetadata.filename])
  const sha256 = await sha256File(path)
  requireEqual(listedChecksums.get(ccxMetadata.filename), sha256, `SHA256 for ${ccxMetadata.filename}`)
  requireEqual(ccxMetadata.sha256.toLowerCase(), sha256, "ccx-release.json CCX SHA256")

  return {
    version: ccxVersion,
    ccxVersion,
    releaseDir: join(root, "dist"),
    checksumPath,
    ccxMetadataPath,
    ccxMetadata,
    artifacts: {
      ccx: { filename: ccxMetadata.filename, path, sha256, size: fileStats.size }
    }
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

function readElementText(html, attribute, label) {
  const expectedAttribute = `${escapeRegExp(attribute)}(?:=["'][^"']*["'])?`
  const match = new RegExp(
    `<[^>]+(?=[^>]*\\b${expectedAttribute})[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "i"
  ).exec(html)
  if (!match) fail(`${label} is missing ${attribute}`)
  return match[1].replace(/<[^>]*>/g, "").trim()
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
  const verifiedBundle = bundle ?? await verifyCcxRelease({ root })
  const { version, artifacts, ccxMetadata } = verifiedBundle
  const latestPath = join(siteDir, "releases", "latest.json")
  const releaseRootUrl = ccxMetadata.releaseUrl
  const releaseOrigin = new URL(releaseRootUrl).origin
  const latest = JSON.parse(materializeReleaseOrigin(await readFile(latestPath, "utf8"), releaseOrigin))
  const updateCheckUrl = new URL("latest.json", releaseRootUrl).href
  const releaseBaseUrl = new URL(`${version}/`, releaseRootUrl).href.replace(/\/$/, "")
  const expectedReleaseUrl = `${releaseBaseUrl}/SHA256SUMS.txt`

  requireObject(latest, "site/releases/latest.json")
  requireEqual(latest.version, version, "latest.json version")
  requireEqual(latest.tag, `v${version}`, "latest.json tag")
  requireEqual(latest.releaseUrl, expectedReleaseUrl, "latest.json releaseUrl")
  requireEqual(latest.updateCheckUrl, updateCheckUrl, "latest.json updateCheckUrl")
  requireObject(latest.downloads, "latest.json downloads")

  requireEqual(Object.keys(latest.downloads).sort().join(","), "ccx", "latest.json download keys")
  for (const key of ["ccx"]) {
    const artifact = artifacts[key]
    const download = latest.downloads[key]
    requireObject(download, `latest.json downloads.${key}`)
    requireEqual(download.filename, artifact.filename, `latest.json downloads.${key}.filename`)
    requireEqual(download.url, `${releaseBaseUrl}/${artifact.filename}`, `latest.json downloads.${key}.url`)
    requireEqual(download.sha256, artifact.sha256, `latest.json downloads.${key}.sha256`)
    requireEqual(download.size, artifact.size, `latest.json downloads.${key}.size`)
  }

  const html = materializeReleaseOrigin(await readFile(join(siteDir, "index.html"), "utf8"), releaseOrigin)
  const ccx = artifacts.ccx
  const ccxAnchor = findAnchor(html, "data-download", "ccx")
  requireEqual(readHref(ccxAnchor, "site/index.html CCX download"), `${releaseBaseUrl}/${ccx.filename}`, "site/index.html CCX href")
  requireEqual(ccxAnchor.replace(/<[^>]*>/g, "").trim(), "Download CCX", "site/index.html CCX label")
  const webUiAnchor = findAnchor(html, "data-open-webui")
  requireEqual(readHref(webUiAnchor, "site/index.html WebUI link"), "./webui/", "site/index.html WebUI href")
  requireEqual(webUiAnchor.replace(/<[^>]*>/g, "").trim(), "Open WebUI", "site/index.html WebUI label")
  requireEqual(readElementText(html, "data-ccx-version", "site/index.html specimen version"), version, "site/index.html specimen version")

  const llmsLowerRaw = materializeReleaseOrigin(await readFile(join(siteDir, "llms.txt"), "utf8"), releaseOrigin)
  const llmsUpperRaw = materializeReleaseOrigin(await readFile(join(siteDir, "LLM.TXT"), "utf8"), releaseOrigin)
  requireEqual(llmsUpperRaw, llmsLowerRaw, "site/LLM.TXT content")
  const llms = normalizeNewlines(llmsLowerRaw)

  requireEqual(readLabeledValue(llms, "Current version:"), version, "llms.txt current version")
  requireEqual(readLabeledValue(llms, "Minimum supported version:"), latest.minimumSupportedVersion, "llms.txt minimum supported version")
  requireEqual(readLabeledValue(llms, "Published at:"), latest.publishedAt, "llms.txt published at")
  requireEqual(readFollowingLine(llms, "Version check:"), `GET ${updateCheckUrl}`, "llms.txt version check URL")
  requireEqual(readFollowingLine(llms, "Manifest:"), updateCheckUrl, "llms.txt manifest URL")
  requireEqual(readFollowingLine(llms, "Release checksums:"), expectedReleaseUrl, "llms.txt release checksums URL")

  for (const [key, heading] of [["ccx", "Adobe Photoshop plugin:"]]) {
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
  const bundle = await verifyCcxRelease(options)
  return await verifySiteMetadata({ ...options, bundle })
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  const { bundle } = await verifyReleaseSite()
  console.log(`Verified release ${bundle.version} at ${bundle.releaseDir}`)
}
