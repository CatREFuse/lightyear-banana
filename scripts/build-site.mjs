import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyReleaseSite } from "./verify-release-bundle.mjs"

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
const siteDir = join(root, "site")
const outDir = join(root, "dist", "site")

const { bundle, latest: manifest } = await verifyReleaseSite({ root, siteDir })

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
await cp(siteDir, outDir, {
  recursive: true,
  filter: (source) => !source.endsWith(".DS_Store")
})

await writeFile(join(outDir, "releases", "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Built site for ${manifest.name} ${bundle.version} at ${outDir}`)
