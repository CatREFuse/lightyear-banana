import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@mugen/inner-protocol': fileURLToPath(new URL('../packages/inner-protocol/src/index.ts', import.meta.url)),
      '@mugen/core': fileURLToPath(new URL('../packages/mugen-core/src/index.ts', import.meta.url))
    }
  },
  define: {
    __WEBUI_VERSION__: JSON.stringify('0.2.3'),
    __BUILD_COMMIT__: JSON.stringify('test')
  },
  test: {
    include: ['src/**/*.test.ts']
  }
})
