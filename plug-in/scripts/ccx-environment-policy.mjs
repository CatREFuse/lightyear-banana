const validMugenEnvironments = new Set(['development', 'test', 'production'])
const forbiddenProductionEnvironments = new Set(['development', 'test'])

export function resolveCcxMugenEnvironment(mode, environment = {}) {
  if (mode === 'production') {
    for (const key of ['VITE_MUGEN_ENV', 'MUGEN_ENV']) {
      if (forbiddenProductionEnvironments.has(environment[key])) {
        throw new Error(`Production CCX builds cannot use ${key}=${environment[key]}.`)
      }
    }
    return 'production'
  }

  const configured = environment.VITE_MUGEN_ENV ?? environment.MUGEN_ENV
  return validMugenEnvironments.has(configured) ? configured : 'development'
}
