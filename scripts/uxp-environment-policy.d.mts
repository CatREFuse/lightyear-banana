export type MugenEnvironment = 'development' | 'test' | 'production'

export function resolveUxpMugenEnvironment(
  mode: string,
  environment?: Record<string, string | undefined>
): MugenEnvironment
