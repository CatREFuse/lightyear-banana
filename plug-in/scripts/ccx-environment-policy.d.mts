export type MugenEnvironment = 'development' | 'test' | 'production'

export function resolveCcxMugenEnvironment(
  mode: string,
  environment?: Record<string, string | undefined>
): MugenEnvironment
