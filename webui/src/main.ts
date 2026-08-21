import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/fonts.css'
import './style.css'
import './styles/imini-theme.css'

createApp(App).use(createPinia()).mount('#app')
