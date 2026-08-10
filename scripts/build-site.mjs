import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyReleaseSite } from "./verify-release-bundle.mjs"

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
const siteDir = join(root, "site")
const outDir = join(root, "dist", "site")
const releaseOriginPlaceholder = "__LIGHTYEAR_RELEASE_ORIGIN__"

const { bundle, latest: manifest } = await verifyReleaseSite({ root, siteDir })

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
await cp(siteDir, outDir, {
  recursive: true,
  filter: (source) => !source.endsWith(".DS_Store")
})

const releaseOrigin = new URL(bundle.uxpMetadata.releaseUrl).origin
for (const relativePath of ["index.html", "llms.txt", "LLM.TXT"]) {
  const target = join(outDir, relativePath)
  const contents = await readFile(target, "utf8")
  await writeFile(target, contents.replaceAll(releaseOriginPlaceholder, releaseOrigin))
}
await writeFile(join(outDir, "releases", "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Built site for ${manifest.name} ${bundle.version} at ${outDir}`)
