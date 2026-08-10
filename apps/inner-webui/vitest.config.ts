import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@lightyear-banana/inner-protocol': fileURLToPath(new URL('../../packages/inner-protocol/src/index.ts', import.meta.url))
    }
  },
  define: {
    __WEBUI_VERSION__: JSON.stringify('0.1.0'),
    __BUILD_COMMIT__: JSON.stringify('test')
  },
  test: {
    include: ['src/**/*.test.ts']
  }
})
