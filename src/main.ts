import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import type { DesktopPlatform, RuntimeName } from './types/lightyear'

const params = new URLSearchParams(window.location.search)
const runtime: RuntimeName = params.get('runtime') === 'electron' ? 'electron' : 'browser'
const platform: DesktopPlatform = params.get('platform') === 'win32' ? 'win32' : 'darwin'

createApp(App, { runtime, platform }).mount('#app')
