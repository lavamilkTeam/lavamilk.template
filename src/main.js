import { createApp } from 'vue'
import App from './App.vue'
import './assets/globals.css'
import reveal from './plugins/reveal'
import { i18n } from './i18n'
import { router } from './router'

const app = createApp(App).use(i18n).use(reveal).use(router)
router.isReady().then(() => app.mount('#app'))
