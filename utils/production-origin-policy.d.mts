export function normalizeProductionHostname(value: unknown): string
export function isDisallowedProductionHostname(value: unknown): boolean
export function assertProductionOrigin(value: string, label?: string): string
export function resolveReleaseUrl(options: {
  processEnvironment?: Record<string, string | undefined>
  keyEnvironment?: Record<string, string | undefined>
  viteEnvironment?: Record<string, string | undefined>
  webviewOrigin: string
  production?: boolean
}): URL
