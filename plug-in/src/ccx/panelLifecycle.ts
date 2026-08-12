export type PanelLifecycleOperations = {
  mount: (rootNode: unknown) => void | Promise<void>
  destroy: () => void | Promise<void>
}

export function createPanelLifecycle(operations: PanelLifecycleOperations) {
  return {
    async create(rootNode: unknown) {
      await operations.mount(rootNode)
    },
    async show(rootNode: unknown) {
      await operations.mount(rootNode)
    },
    async destroy() {
      await operations.destroy()
    }
  }
}
