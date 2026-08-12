import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyReleaseSite } from "./verify-release-bundle.mjs"
import {
  createSiteManifest,
  createSiteReleaseMetadata,
  readGitSiteProvenance,
  siteManifestFileName,
  siteReleaseFileName
} from "./site-release-provenance.mjs"

const root = dirname(fileURLToPath(new URL("../../package.json", import.meta.url)))
const siteDir = join(root, "homesite", "site")
const outDir = join(root, "dist", "site")
const releaseOriginPlaceholder = "__MUGEN_RELEASE_ORIGIN__"

const { bundle } = await verifyReleaseSite({ root, siteDir })

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
await cp(siteDir, outDir, {
  recursive: true,
  filter: (source) => !source.endsWith(".DS_Store")
})

const releaseOrigin = new URL(bundle.ccxMetadata.webviewOrigin).origin
for (const relativePath of ["index.html", "llms.txt", "LLM.TXT"]) {
  const target = join(outDir, relativePath)
  const contents = await readFile(target, "utf8")
  await writeFile(target, contents.replaceAll(releaseOriginPlaceholder, releaseOrigin))
}
const ccx = bundle.artifacts.ccx
const downloadDir = join(outDir, "download")
await mkdir(downloadDir, { recursive: true })
await cp(ccx.path, join(downloadDir, ccx.filename))

const git = readGitSiteProvenance(root)
const siteRelease = createSiteReleaseMetadata({ directory: outDir, ...git })
await writeFile(join(outDir, siteReleaseFileName), `${JSON.stringify(siteRelease, null, 2)}\n`)
const siteManifest = createSiteManifest(outDir, siteRelease)
await writeFile(join(outDir, siteManifestFileName), `${JSON.stringify(siteManifest, null, 2)}\n`)

console.log(`Built site for Mugen ${bundle.version} (${siteRelease.buildId}) at ${outDir}`)
