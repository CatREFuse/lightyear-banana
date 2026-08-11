import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import '../../../src/styles/fonts.css'
import '../../../src/style.css'
import '../../../src/styles/nothing-theme.css'

createApp(App).use(createPinia()).mount('#app')
