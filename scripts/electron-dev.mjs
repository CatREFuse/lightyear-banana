import { spawn } from 'node:child_process'

const env = { ...process.env }
let viteReady = false

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
      VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173'
    }
  })

  electron.on('exit', (code) => {
    vite.kill('SIGTERM')
    process.exit(code ?? 0)
  })
}

vite.stdout.on('data', (chunk) => {
  if (!viteReady && chunk.toString().includes('Local:')) {
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
