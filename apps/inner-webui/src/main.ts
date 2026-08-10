import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/workspace' },
    { path: '/workspace', component: () => import('./views/WorkspaceView.vue') },
    { path: '/settings', component: () => import('./views/SettingsView.vue') },
    { path: '/settings/new', component: () => import('./views/ConfigView.vue') },
    { path: '/settings/:configId', component: () => import('./views/ConfigView.vue'), props: true }
  ]
})

createApp(App).use(createPinia()).use(router).mount('#app')
