import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import type { RuntimeName } from './types/lightyear'

const runtime: RuntimeName = new URLSearchParams(window.location.search).get('runtime') === 'electron' ? 'electron' : 'browser'

createApp(App, { runtime }).mount('#app')
