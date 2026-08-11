import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@mugen/inner-protocol': fileURLToPath(new URL('../../packages/inner-protocol/src/index.ts', import.meta.url))
    }
  },
  define: {
    __WEBUI_VERSION__: JSON.stringify('0.2.0'),
    __BUILD_COMMIT__: JSON.stringify('test'),
    __MUGEN_LEGACY_DESKTOP__: 'false'
  },
  test: {
    include: ['src/**/*.test.ts']
  }
})
