import { onBeforeUnmount, onMounted, toValue, type MaybeRefOrGetter } from 'vue'

type OutsideTarget = Element | null | undefined

export function useOutsidePointerDown(
  target: MaybeRefOrGetter<OutsideTarget>,
  onOutside: () => void,
  isActive: () => boolean
) {
  function handlePointerDown(event: Event) {
    if (!isActive()) {
      return
    }

    const root = toValue(target)
    const eventTarget = event.target
    if (!root || !eventTarget || !('nodeType' in eventTarget)) {
      return
    }

    if (root.contains(eventTarget as Node)) {
      return
    }

    onOutside()
  }

  onMounted(() => {
    document.addEventListener('pointerdown', handlePointerDown, true)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', handlePointerDown, true)
  })
}
