import { createServer } from 'node:http';
import { createApplication } from './community/index.js';
const e=process.env;
if (!e.DATABASE_URL || !e.PUBLIC_ORIGIN) throw new Error('DATABASE_URL and PUBLIC_ORIGIN are required');
const app=await createApplication({databaseUrl:e.DATABASE_URL,origin:e.PUBLIC_ORIGIN,
  accountDatabaseUrl:e.ACCOUNT_DATABASE_URL,
  clientId:e.GITHUB_CLIENT_ID,clientSecret:e.GITHUB_CLIENT_SECRET,githubToken:e.PIG_GITHUB_TOKEN,
  ai:{url:e.PIG_AI_URL,model:e.PIG_AI_MODEL,key:e.PIG_AI_KEY,provider:e.PIG_AI_PROVIDER}});
const server=createServer(app.handler);
server.requestTimeout=115000;server.headersTimeout=15000;
server.listen(Number(e.PORT || 8091),'127.0.0.1',()=>console.log('Community API listening on loopback'));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(async()=>{await app.close();process.exit(0);}));
