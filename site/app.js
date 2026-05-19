const releaseUrl = "/releases/latest.json"

function setText(selector, value) {
  document.querySelectorAll(selector).forEach((node) => {
    node.textContent = value
  })
}

function updateDownloadLink(key, asset) {
  const link = document.querySelector(`[data-download="${key}"]`)
  if (!link || !asset) {
    return
  }

  const fileLabel = link.querySelector("span:last-child")
  link.setAttribute("href", asset.url)
  if (fileLabel) {
    fileLabel.textContent = asset.filename
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
    updateDownloadLink("mac", release.downloads?.mac)
    updateDownloadLink("win", release.downloads?.windows)
    updateDownloadLink("ccx", release.downloads?.ccx)
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
mountReveal()
