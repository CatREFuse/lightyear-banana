import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
const siteDir = join(root, "site")
const outDir = join(root, "dist", "site")
const manifestPath = join(siteDir, "releases", "latest.json")

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
const manifest = JSON.parse(await readFile(manifestPath, "utf8"))

if (manifest.version !== packageJson.version) {
  throw new Error(`site release version ${manifest.version} does not match package version ${packageJson.version}`)
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
await cp(siteDir, outDir, {
  recursive: true,
  filter: (source) => !source.endsWith(".DS_Store")
})

await writeFile(join(outDir, "releases", "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Built site for ${manifest.name} ${manifest.version} at ${outDir}`)
