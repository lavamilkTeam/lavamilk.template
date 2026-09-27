import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import ui from '@nuxt/ui/vite';

export default defineConfig({
  base: '/ai-chat/',
  plugins: [vue(), ui({ ui: { colors: { primary: 'blue', neutral: 'zinc' } } })],
});
