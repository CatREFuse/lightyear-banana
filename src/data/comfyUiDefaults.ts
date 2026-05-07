import type { ComfyUiNodeMapping, ComfyUiSettings } from '../types/lightyear'

const productionDefaultWorkflowNodes: ComfyUiNodeMapping[] = [
  { type: 'prompt', nodeIds: [], key: 'text' },
  { type: 'negative_prompt', nodeIds: [], key: 'text' },
  { type: 'image', nodeIds: [], key: 'image' }
]

const legacyDefaultNodeSignatures = [
  'prompt:text',
  'negative_prompt:text',
  'image:image',
  'width:width',
  'height:height',
  'steps:steps',
  'seed:seed'
]

function isLegacyEmptyWorkflowNodes(nodes: ComfyUiNodeMapping[]) {
  if (nodes.length !== legacyDefaultNodeSignatures.length) {
    return false
  }

  return nodes.every((node, index) => {
    const signature = `${node.type}:${node.key}`

    return signature === legacyDefaultNodeSignatures[index] && node.nodeIds.length === 0 && !node.value
  })
}

export function createDefaultComfyUiSettings(): ComfyUiSettings {
  return {
    workflow: '',
    workflowNodes: productionDefaultWorkflowNodes.map((node) => ({ ...node, nodeIds: [...node.nodeIds] })),
    timeoutMs: 180000,
    pollIntervalMs: 2000
  }
}

export function normalizeComfyUiSettings(value: unknown): ComfyUiSettings {
  const fallback = createDefaultComfyUiSettings()
  if (!value || typeof value !== 'object') {
    return fallback
  }

  const settings = value as Partial<ComfyUiSettings>
  const workflowNodes = Array.isArray(settings.workflowNodes)
    ? settings.workflowNodes
        .filter((node) => node && typeof node === 'object')
        .map((node) => ({
          type: node.type ?? 'custom',
          nodeIds: Array.isArray(node.nodeIds) ? node.nodeIds.filter((id): id is string => typeof id === 'string') : [],
          key: typeof node.key === 'string' ? node.key : '',
          value: typeof node.value === 'string' ? node.value : undefined
        }))
    : fallback.workflowNodes

  return {
    workflow: typeof settings.workflow === 'string' ? settings.workflow : fallback.workflow,
    workflowNodes: isLegacyEmptyWorkflowNodes(workflowNodes) ? fallback.workflowNodes : workflowNodes,
    timeoutMs: Number.isFinite(settings.timeoutMs) ? Number(settings.timeoutMs) : fallback.timeoutMs,
    pollIntervalMs: Number.isFinite(settings.pollIntervalMs) ? Number(settings.pollIntervalMs) : fallback.pollIntervalMs
  }
}
