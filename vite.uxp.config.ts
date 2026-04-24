import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const uxpOutDir = path.resolve(projectRoot, 'dist/ps-uxp')

function uxpPostBuildPlugin(): Plugin {
  return {
    name: 'uxp-post-build',
    closeBundle() {
      const panelPath = path.join(uxpOutDir, 'uxp-panel.html')
      const manifestSource = path.join(projectRoot, 'plugin', 'manifest.json')
      const manifestTarget = path.join(uxpOutDir, 'manifest.json')
      const iconsSource = path.join(projectRoot, 'plugin', 'icons')
      const iconsTarget = path.join(uxpOutDir, 'icons')

      let html = readFileSync(panelPath, 'utf8')
      html = html
        .replace(/\s+type=(["'])module\1/g, '')
        .replace(/\s+crossorigin(?:=(["']).*?\1)?/g, '')

      const scripts: string[] = []
      html = html.replace(/\s*<script\s+src=(["'])([^"']+)\1\s*><\/script>/g, (tag) => {
        scripts.push(tag.trim())
        return ''
      })
      if (scripts.length) {
        html = html.replace(/\s*<\/body>/, `\n    ${scripts.join('\n    ')}\n  </body>`)
      }
      writeFileSync(panelPath, html)

      mkdirSync(uxpOutDir, { recursive: true })
      copyFileSync(manifestSource, manifestTarget)
      cpSync(iconsSource, iconsTarget, { recursive: true })
    }
  }
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [vue(), uxpPostBuildPlugin()],
  build: {
    modulePreload: {
      polyfill: false
    },
    outDir: uxpOutDir,
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./uxp-panel.html', import.meta.url)),
      output: {
        format: 'iife'
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
