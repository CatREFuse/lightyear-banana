import { createPrismScene } from './prism-scene.js'

const releaseUrl = './releases/latest.json'

function updateRelease(release) {
  const ccx = release?.downloads?.ccx
  const download = document.querySelector('[data-download="ccx"]')
  const version = document.querySelector('[data-ccx-version]')
  const specimenVersion = typeof release?.ccxVersion === 'string'
    ? release.ccxVersion
    : /^mugen-(\d+\.\d+\.\d+)\.ccx$/.exec(ccx?.filename || '')?.[1]

  if (specimenVersion && ccx?.url && download instanceof HTMLAnchorElement) {
    download.href = ccx.url
  }

  if (typeof specimenVersion === 'string' && version) {
    version.textContent = specimenVersion
  }
}

async function loadRelease() {
  try {
    const response = await fetch(releaseUrl, { cache: 'no-store' })
    if (!response.ok) return
    updateRelease(await response.json())
  } catch {
    // Keep the static CCX fallback available when release metadata cannot be loaded.
  }
}

const canvas = document.querySelector('[data-prism-canvas]')
const stage = document.querySelector('[data-optical-stage]')

if (canvas instanceof HTMLCanvasElement && stage instanceof HTMLElement) {
  try {
    createPrismScene(canvas, stage)
  } catch {
    stage.classList.add('webgl-unavailable')
  }
}

loadRelease()
