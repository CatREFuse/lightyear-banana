import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

type MugenEnvironment = 'development' | 'test' | 'production'

const environmentValues = new Set<MugenEnvironment>(['development', 'test', 'production'])

function resolveMugenEnvironment(mode: string): MugenEnvironment {
  const env = loadEnv(mode, process.cwd(), '')
  const rawEnvironment =
    env.VITE_MUGEN_ENV ?? env.MUGEN_ENV ?? env.VITE_LIGHTYEAR_ENV ?? env.LIGHTYEAR_ENV

  if (environmentValues.has(rawEnvironment as MugenEnvironment)) {
    return rawEnvironment as MugenEnvironment
  }

  return mode === 'production' ? 'production' : 'development'
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const mugenEnvironment = resolveMugenEnvironment(mode)

  return {
    plugins: [vue()],
    define: {
      __MUGEN_APP_ENV__: JSON.stringify(mugenEnvironment),
      __MUGEN_VERSION__: JSON.stringify(packageJson.version)
    }
  }
})
