import { fileURLToPath, URL } from 'node:url'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'
import { PROTOCOL_VERSION } from '../../packages/inner-protocol/src/index'

const appRoot = fileURLToPath(new URL('.', import.meta.url))
const distRoot = fileURLToPath(new URL('./dist/', import.meta.url))
const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string }
const webVersion = packageJson.version
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const gitCommit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' })
const gitStatus = spawnSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' })
const gitCommitTimestamp = spawnSync('git', ['show', '-s', '--format=%ct', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' })
const buildCommit = process.env.INNER_WEBUI_COMMIT_SHA || process.env.GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || gitCommit.stdout.trim() || 'local'
const buildDirty = gitStatus.status === 0 ? Boolean(gitStatus.stdout.trim()) : undefined
const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH || gitCommitTimestamp.stdout.trim()
const builtAt = /^\d+$/.test(sourceDateEpoch)
  ? new Date(Number(sourceDateEpoch) * 1000).toISOString()
  : new Date(0).toISOString()

function releaseMetadata(): Plugin {
  function outputFiles(directory: string, prefix = ''): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      return entry.isDirectory() ? outputFiles(`${directory}/${entry.name}`, name) : [name]
    })
  }

  return {
    name: 'inner-webui-release-metadata',
    enforce: 'post',
    apply: 'build',
    closeBundle() {
      const compatibility = JSON.stringify({ schemaVersion: 1, webVersion, protocolVersion: PROTOCOL_VERSION, compatibleHostProtocolVersions: [PROTOCOL_VERSION] }, null, 2)
      writeFileSync(`${distRoot}/compatibility.json`, compatibility)
      const hash = createHash('sha256')
      const files = outputFiles(distRoot).filter(file => file !== 'release.json').sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      for (const file of files) {
        hash.update(file)
        hash.update('\0')
        hash.update(readFileSync(`${distRoot}/${file}`))
        hash.update('\0')
      }
      const contentHash = hash.digest('hex')
      writeFileSync(`${distRoot}/release.json`, JSON.stringify({ schemaVersion: 1, webVersion, protocolVersion: PROTOCOL_VERSION, compatibleHostProtocolVersions: [PROTOCOL_VERSION], buildId: `${webVersion}-${contentHash.slice(0, 12)}`, contentHash: `sha256:${contentHash}`, commit: buildCommit, dirty: buildDirty, builtAt }, null, 2))
    }
  }
}

function webviewCsp(): Plugin {
  let productionBuild = false
  return {
    name: 'inner-webui-csp',
    configResolved(config) {
      productionBuild = config.command === 'build'
    },
    transformIndexHtml(html, context) {
      const connectSource = context.server ? "'self' ws://127.0.0.1:4173" : "'none'"
      const inlineStyleSource = context.server ? "'unsafe-inline'" : ''
      return html
        .replace('__CONNECT_SOURCE__', connectSource)
        .replace('__STYLE_SOURCE__', inlineStyleSource)
    },
    closeBundle() {
      if (!productionBuild) return
      const html = readFileSync(`${distRoot}/index.html`, 'utf8')
      if (!html.includes("connect-src 'none'")) throw new Error('Production CSP must disable direct WebUI network access')
      if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) throw new Error('Production WebUI must not contain inline scripts')
    }
  }
}

export default defineConfig({
  root: appRoot,
  base: './',
  plugins: [vue(), tailwindcss(), webviewCsp(), releaseMetadata()],
  define: {
    __WEBUI_VERSION__: JSON.stringify(webVersion),
    __BUILD_COMMIT__: JSON.stringify(buildCommit)
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), '@lightyear-banana/inner-protocol': fileURLToPath(new URL('../../packages/inner-protocol/src/index.ts', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: 'dist', assetsDir: 'assets', sourcemap: false, target: 'es2022' }
})
