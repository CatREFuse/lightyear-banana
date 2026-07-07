import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

type LightyearEnvironment = 'development' | 'test' | 'production'

const environmentValues = new Set<LightyearEnvironment>(['development', 'test', 'production'])

function resolveLightyearEnvironment(mode: string): LightyearEnvironment {
  const env = loadEnv(mode, process.cwd(), '')
  const rawEnvironment = env.VITE_LIGHTYEAR_ENV ?? env.LIGHTYEAR_ENV

  if (environmentValues.has(rawEnvironment as LightyearEnvironment)) {
    return rawEnvironment as LightyearEnvironment
  }

  return mode === 'production' ? 'production' : 'development'
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const lightyearEnvironment = resolveLightyearEnvironment(mode)

  return {
    plugins: [vue()],
    define: {
      __LIGHTYEAR_APP_ENV__: JSON.stringify(lightyearEnvironment),
      __LIGHTYEAR_VERSION__: JSON.stringify(packageJson.version)
    }
  }
})
