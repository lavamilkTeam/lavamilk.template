import './style.css';
import { createApp } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import ui from '@nuxt/ui/vue-plugin';
import AgentChat from './AgentChat.vue';

const app = createApp(AgentChat);
app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] }));
app.use(ui);
app.mount('#app');
