// Root files are public entry points; nested implementation and tests are private.
const modules = ['server/community', 'server/migrations', 'scripts/cms-sync', 'src/features/pig-king', 'src/features/ai-agent',
  'pocketbase/pb_hooks/pig-account', 'pocketbase/pb_hooks/pig-king'];
module.exports = {
  forbidden: [
    { name: 'chat-app-isolated', severity: 'error', from: { path: '^apps/ai-agent/' }, to: { path: '^(src|server|pocketbase)/' } },
    { name: 'site-no-chat-internals', severity: 'error', from: { path: '^(src|server|pocketbase)/' }, to: { path: '^apps/ai-agent/' } },
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    { name: 'community-private', severity: 'error', from: { pathNot: '^server/community/(index\\.js|lib/)' }, to: { path: '^server/community/lib/' } },
    { name: 'no-production-test-imports', severity: 'error', from: { pathNot: '/tests/' }, to: { path: '/tests/' } },
    { name: 'no-browser-backend-imports', severity: 'error', from: { path: '^src/' }, to: { path: '^(server|pocketbase)/' } },
    { name: 'no-backend-browser-imports', severity: 'error', from: { path: '^(server|pocketbase)/' }, to: { path: '^src/' } },
    ...modules.flatMap(root => [
      { name: root.replaceAll('/', '-') + '-private', severity: 'error',
        from: { pathNot: `^${root}/(?!tests/)` }, to: { path: `^${root}/[^/]+/`, pathNot: `^${root}/tests/` } },
      { name: root.replaceAll('/', '-') + '-test-private', severity: 'error',
        from: { pathNot: `^${root}/tests/` }, to: { path: `^${root}/tests/` } },
    ]),
  ],
  options: { doNotFollow: { path: 'node_modules' }, exclude: { path: 'node_modules' } },
};
