import type { Component } from 'vue'
import { ArrowLeft, Copy, Fullscreen, Layers } from '@boxicons/vue'
import {
  RiAddLargeFill,
  RiArrowDownSLine,
  RiArrowLeftRightLine,
  RiArrowRightSLine,
  RiArrowUpLine,
  RiAspectRatioLine,
  RiCheckboxCircleFill,
  RiClipboardLine,
  RiCloseLine,
  RiCodeSFill,
  RiDeleteBin6Line,
  RiDownloadLine,
  RiFocus3Line,
  RiHardDrive3Line,
  RiHashtag,
  RiImageAddLine,
  RiKey2Line,
  RiListOrdered,
  RiMoonLine,
  RiPictureInPictureFill,
  RiRefreshLine,
  RiRestartLine,
  RiSettingsLine,
  RiShiningFill,
  RiShiningLine,
  RiSparkling2Line,
  RiSunLine,
  RiUploadLine,
  RiZoomInLine
} from '@remixicon/vue'

export type AppIconLibrary = 'boxicons' | 'remix'

export type AppIconDefinition = {
  component: Component
  library: AppIconLibrary
}

export const appIcons = {
  'add-large-fill': { component: RiAddLargeFill, library: 'remix' },
  'arrow-down-s-line': { component: RiArrowDownSLine, library: 'remix' },
  'arrow-left-right-line': { component: RiArrowLeftRightLine, library: 'remix' },
  'arrow-right-s-line': { component: RiArrowRightSLine, library: 'remix' },
  'arrow-up-line': { component: RiArrowUpLine, library: 'remix' },
  'aspect-ratio-line': { component: RiAspectRatioLine, library: 'remix' },
  'bx-arrow-back': { component: ArrowLeft, library: 'boxicons' },
  'bx-copy': { component: Copy, library: 'boxicons' },
  'bx-fullscreen': { component: Fullscreen, library: 'boxicons' },
  'bx-layer': { component: Layers, library: 'boxicons' },
  'checkbox-circle-fill': { component: RiCheckboxCircleFill, library: 'remix' },
  'clipboard-line': { component: RiClipboardLine, library: 'remix' },
  'close-line': { component: RiCloseLine, library: 'remix' },
  'code-s-fill': { component: RiCodeSFill, library: 'remix' },
  'delete-bin-6-line': { component: RiDeleteBin6Line, library: 'remix' },
  'download-line': { component: RiDownloadLine, library: 'remix' },
  'focus-3-line': { component: RiFocus3Line, library: 'remix' },
  'hard-drive-3-line': { component: RiHardDrive3Line, library: 'remix' },
  hashtag: { component: RiHashtag, library: 'remix' },
  'image-add-line': { component: RiImageAddLine, library: 'remix' },
  'key-2-line': { component: RiKey2Line, library: 'remix' },
  'list-ordered': { component: RiListOrdered, library: 'remix' },
  'moon-line': { component: RiMoonLine, library: 'remix' },
  'picture-in-picture-fill': { component: RiPictureInPictureFill, library: 'remix' },
  'refresh-line': { component: RiRefreshLine, library: 'remix' },
  'restart-line': { component: RiRestartLine, library: 'remix' },
  'settings-line': { component: RiSettingsLine, library: 'remix' },
  'shining-fill': { component: RiShiningFill, library: 'remix' },
  'shining-line': { component: RiShiningLine, library: 'remix' },
  'sparkling-2-line': { component: RiSparkling2Line, library: 'remix' },
  'sun-line': { component: RiSunLine, library: 'remix' },
  'upload-line': { component: RiUploadLine, library: 'remix' },
  'zoom-in-line': { component: RiZoomInLine, library: 'remix' }
} as const satisfies Record<string, AppIconDefinition>

export type AppIconName = keyof typeof appIcons
