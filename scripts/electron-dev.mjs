import { spawn } from 'node:child_process'

const env = { ...process.env }
let viteReady = false
let devServerUrl = 'http://127.0.0.1:5173'

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    ...options
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
  })

  return child
}

const vite = run('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], { env })
let electron

function startElectron() {
  if (electron) {
    return
  }

  electron = run('npx', ['electron', 'electron/main.js'], {
    env: {
      ...env,
      VITE_DEV_SERVER_URL: devServerUrl
    }
  })

  electron.on('exit', (code) => {
    vite.kill('SIGTERM')
    process.exit(code ?? 0)
  })
}

vite.stdout.on('data', (chunk) => {
  const output = chunk.toString()
  const localUrl = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/?)/)
  if (localUrl?.[1]) {
    devServerUrl = localUrl[1].replace(/\/$/, '')
  }

  if (!viteReady && output.includes('Local:')) {
    viteReady = true
    startElectron()
  }
})

vite.on('exit', (code) => {
  if (electron) {
    electron.kill('SIGTERM')
  }
  process.exit(code ?? 0)
})

process.on('SIGINT', () => {
  electron?.kill('SIGTERM')
  vite.kill('SIGTERM')
})
