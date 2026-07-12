const releaseUrl = "/releases/latest.json"
const githubRepoApiUrl = "https://api.github.com/repos/CatREFuse/lightyear-banana"

function setText(selector, value) {
  document.querySelectorAll(selector).forEach((node) => {
    node.textContent = value
  })
}

function setHref(selector, value) {
  if (!value) {
    return
  }

  document.querySelectorAll(selector).forEach((node) => {
    node.setAttribute("href", value)
  })
}

function formatBytes(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return ""
  }

  const units = ["B", "KB", "MB", "GB"]
  let value = size
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

function formatCount(value) {
  if (!Number.isFinite(value) || value < 0) {
    return "--"
  }

  return new Intl.NumberFormat("en-US").format(value)
}

function updateDownloadLink(key, asset) {
  const link = document.querySelector(`[data-download="${key}"]`)
  if (!link || !asset) {
    return
  }

  const fileLabel = link.querySelector(".download-file")
  const sizeLabel = link.querySelector(".download-size")
  link.setAttribute("href", asset.url)
  if (fileLabel) {
    fileLabel.textContent = asset.filename
  }
  if (sizeLabel) {
    const formatted = formatBytes(asset.size)
    if (formatted) {
      sizeLabel.textContent = formatted
    }
  }
}

async function hydrateRelease() {
  try {
    const response = await fetch(releaseUrl, { cache: "no-store" })
    if (!response.ok) {
      return
    }

    const release = await response.json()
    setText("[data-release-version]", release.version)
    setHref("[data-release-url]", release.releaseUrl)
    setHref("[data-github-url]", release.githubUrl)
    updateDownloadLink("mac", release.downloads?.mac)
    updateDownloadLink("win", release.downloads?.windows)
    updateDownloadLink("ccx", release.downloads?.ccx)
  } catch {
    return
  }
}

async function hydrateGithubStars() {
  try {
    const response = await fetch(githubRepoApiUrl, {
      headers: {
        Accept: "application/vnd.github+json"
      }
    })
    if (!response.ok) {
      return
    }

    const repo = await response.json()
    setText("[data-github-stars]", formatCount(repo.stargazers_count))
  } catch {
    return
  }
}

function mountReveal() {
  const items = document.querySelectorAll(".reveal")
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible")
          observer.unobserve(entry.target)
        }
      })
    },
    { threshold: 0.18 }
  )

  items.forEach((item) => observer.observe(item))
}

hydrateRelease()
hydrateGithubStars()
mountReveal()
