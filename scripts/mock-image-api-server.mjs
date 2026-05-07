#!/usr/bin/env node
import {
  defaultMockImageApiHost,
  defaultMockImageApiPort,
  listenMockImageApiServer
} from '../electron/mockImageApiServer.js'

listenMockImageApiServer()
  .then(() => {
    console.log(`Lightyear Banana Image API Mock Server: http://${defaultMockImageApiHost}:${defaultMockImageApiPort}`)
    console.log('Manual: GET /mock/manual')
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
