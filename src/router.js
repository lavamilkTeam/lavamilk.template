import { createRouter, createWebHistory } from 'vue-router';
import Lavamilk from './components/Lavamilk.vue';

const pages = ['home', 'features', 'docs', 'pricing', 'changelog', 'about', 'blog', 'post',
  'careers', 'contact', 'privacy', 'terms', 'security', 'pig-king', 'ai-agent'];

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    ...pages.map(page => ({ path: page === 'home' ? '/' : '/' + page, name: page,
      component: Lavamilk, props: { page } })),
    { path: '/:pathMatch(.*)*', name: 'not-found', component: Lavamilk, props: { page: 'not-found' } },
  ],
  scrollBehavior: (_to, _from, savedPosition) => savedPosition || { top: 0 },
});

// Existing OAuth callbacks and shared hash links keep working during rollout.
router.beforeEach(to => {
  if (to.path === '/' && to.hash === '#pig-king') {
    return { name: 'pig-king', query: to.query, replace: true };
  }
});
