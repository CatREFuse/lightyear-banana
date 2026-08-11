export type ApimartSmokeRequestTrace = {
  sequence: number
  phase: string
  method: string
  path: string
  status: number
  [key: string]: unknown
}

export type ApimartSmokeState = {
  modelChecks: number
  uploads: number
  generations: number
  polls: number
  imageDownloads: number
  lastUpload: null | { bytes: number; contentType: string; hasFile: boolean }
  lastGeneration: null | Record<string, unknown>
  requests: ApimartSmokeRequestTrace[]
}

export type ApimartFixtureServer = {
  host: string
  port: number
  state: ApimartSmokeState
  server: unknown
  reset(): void
  start(): Promise<string>
  stop(): Promise<void>
}

export function createApimartFixtureServer(options?: {
  host?: string
  port?: number
  fixturePath?: string
}): ApimartFixtureServer

export const expectedApiKey: string
