import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { basename, dirname, join, resolve, win32 } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { assertProductionOrigin, resolveReleaseUrl } from "../../utils/production-origin-policy.mjs"

const rootFromScript = dirname(fileURLToPath(new URL("../../package.json", import.meta.url)))
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
  const pluginManifest = JSON.parse(await readFile(join(root, "plug-in", "manifest.json"), "utf8"))
  const pluginPackage = JSON.parse(await readFile(join(root, "plug-in", "package.json"), "utf8"))
  const ccxVersion = requireSemver(pluginManifest.version, "plugin manifest version")
  const buildNumber = pluginPackage.buildNumber
  if (typeof buildNumber !== "string" || !/^\d{6}(?!0000)\d{4}$/.test(buildNumber)) {
    fail("plugin package buildNumber must use YYMMDDnnnn with a non-zero daily counter")
  }

  const ccxMetadataPath = join(root, "dist", "ccx-release.json")
  let ccxMetadata
  try {
    ccxMetadata = JSON.parse(await readFile(ccxMetadataPath, "utf8"))
  } catch (error) {
    fail(`cannot read ${ccxMetadataPath}: ${error.message}`)
  }
  requireObject(ccxMetadata, "dist/ccx-release.json")
  requireEqual(ccxMetadata.schemaVersion, 2, "ccx-release.json schemaVersion")
  requireEqual(ccxMetadata.ccxVersion, ccxVersion, "ccx-release.json ccxVersion")
  requireEqual(ccxMetadata.buildNumber, buildNumber, "ccx-release.json buildNumber")
  requireEqual(ccxMetadata.filename, `mugen-${ccxVersion}-${buildNumber}.ccx`, "ccx-release.json filename")
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
    buildNumber,
    releaseId: `${ccxVersion}+${buildNumber}`,
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
  siteDir = join(root, "homesite", "site"),
  bundle
} = {}) {
  const verifiedBundle = bundle ?? await verifyCcxRelease({ root })
  const { version, artifacts, ccxMetadata } = verifiedBundle
  const releaseOrigin = new URL(ccxMetadata.webviewOrigin).origin
  const ccx = artifacts.ccx
  const downloadUrl = `${releaseOrigin}/download/${ccx.filename}`

  const html = materializeReleaseOrigin(await readFile(join(siteDir, "index.html"), "utf8"), releaseOrigin)
  const ccxAnchor = findAnchor(html, "data-download", "ccx")
  requireEqual(readHref(ccxAnchor, "site/index.html CCX download"), downloadUrl, "site/index.html CCX href")
  requireEqual(ccxAnchor.replace(/<[^>]*>/g, "").trim(), "Download CCX", "site/index.html CCX label")
  const webUiAnchor = findAnchor(html, "data-open-webui")
  requireEqual(readHref(webUiAnchor, "site/index.html WebUI link"), "./webui/", "site/index.html WebUI href")
  requireEqual(webUiAnchor.replace(/<[^>]*>/g, "").trim(), "Open WebUI", "site/index.html WebUI label")
  requireEqual(readElementText(html, "data-ccx-version", "site/index.html specimen version"), version, "site/index.html specimen version")
  requireEqual(readElementText(html, "data-ccx-build", "site/index.html specimen build"), ccxMetadata.buildNumber, "site/index.html specimen build")

  const llmsLowerRaw = materializeReleaseOrigin(await readFile(join(siteDir, "llms.txt"), "utf8"), releaseOrigin)
  const llmsUpperRaw = materializeReleaseOrigin(await readFile(join(siteDir, "LLM.TXT"), "utf8"), releaseOrigin)
  requireEqual(llmsUpperRaw, llmsLowerRaw, "site/LLM.TXT content")
  const llms = normalizeNewlines(llmsLowerRaw)

  requireEqual(readLabeledValue(llms, "Current version:"), version, "llms.txt current version")
  requireEqual(readLabeledValue(llms, "Current build:"), ccxMetadata.buildNumber, "llms.txt current build")
  requireEqual(readLabeledValue(llms, "Packaged at:"), ccxMetadata.builtAt, "llms.txt packaged timestamp")
  const block = readDownloadBlock(llms, "Adobe Photoshop plugin:")
  requireEqual(block.url, downloadUrl, "llms.txt CCX URL")
  requireEqual(block.sha256, ccx.sha256, "llms.txt CCX SHA256")
  requireEqual(block.size, ccx.size, "llms.txt CCX size")

  return { bundle: verifiedBundle, download: { url: downloadUrl, ...ccx } }
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
