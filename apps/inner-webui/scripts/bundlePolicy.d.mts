export type ForbiddenBundleMarker = {
  id: string
  expression: RegExp
}

export const forbiddenBundleMarkers: readonly ForbiddenBundleMarker[]
export const forbiddenSourceModuleSuffixes: readonly string[]
export function findForbiddenSourceModule(moduleId: unknown): string | undefined
export function scanBundleText(
  text: string,
  file?: string
): Array<{ file: string; id: string; marker: string; excerpt: string }>
export function scanBundleDirectory(directory: string): {
  fileCount: number
  scannedFileCount: number
  totalBytes: number
  findings: Array<{ file: string; id: string; marker: string; excerpt: string }>
}
