import { cp, mkdir } from 'node:fs/promises';
const destination = new URL('../dist/ai-chat/', import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL('../apps/ai-agent/dist/', import.meta.url), destination, { recursive: true });
await cp(new URL('../apps/ai-agent/LICENSE', import.meta.url), new URL('LICENSE.txt', destination));
