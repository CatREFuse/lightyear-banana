#!/usr/bin/env node
import {
  defaultCodexImageServerHost,
  defaultCodexImageServerPort,
  listenCodexImageServer
} from '../electron/codexImageServer.js'

listenCodexImageServer()
  .then(() => {
    console.log(`Codex Image Server: http://${defaultCodexImageServerHost}:${defaultCodexImageServerPort}`)
    console.log('Health: GET /healthz')
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
