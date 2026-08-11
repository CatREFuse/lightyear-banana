export function matchesWebViewMessageOrigin(candidate: string | undefined, expectedOrigin: string) {
  if (!candidate) return false
  try {
    return new URL(candidate).origin === expectedOrigin
  } catch {
    return false
  }
}
