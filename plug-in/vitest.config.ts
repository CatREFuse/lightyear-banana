import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    // 根 src/ccx 与 src/data 测试在 vitest 下运行,不经过 vite.ccx.config.ts,
    // 需要为 storage.ts 等模块提供与构建一致的编译期常量。
    __MUGEN_APP_ENV__: JSON.stringify('test'),
    __INNER_WEBUI_URL__: JSON.stringify('plugin:/webui/index.html')
  },
  test: {
    include: ['src/**/*.test.ts']
  }
})
