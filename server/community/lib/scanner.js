// Private resumable history scanner. Each step makes at most one upstream call.
import scoring from '../../../pocketbase/pb_hooks/pig-king/index.cjs';
import { summarize } from './summary.js';
const { scoreRepository } = scoring;
const VERSION = 4;
const DAY = 86400000;
const LIMIT = 10000;
const BYTE_LIMIT = 8 * 1024 * 1024;
function normalizeAccount(input) {
  if (typeof input !== 'string' || input.length > 120) throw new Error('invalidAccount');
  const value = input.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/^@/, '');
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value) || value.includes('--')) throw new Error('invalidAccount');
  return value.toLowerCase();
}
function begin(account, now) {
  return { version: VERSION, account: normalizeAccount(account), phase: 'profile', page: 1, repositories: [], startedAt: new Date(now).toISOString() };
}
const day = timestamp => new Date(timestamp).toISOString().slice(0,10);
const safeUrl = value => typeof value === 'string' && /^https:\/\/github\.com\/[a-z\d_./-]+$/i.test(value);
function compactRepo(r) {
  return { name:r.full_name, description:(r.description || '').slice(0,240), language:r.language || '', stars:r.stargazers_count || 0, fork:!!r.fork, archived:!!r.archived, pushedAt:r.pushed_at };
}
function compact(item, field) {
  if (!safeUrl(item.html_url)) return null;
  const text = field === 'commits' ? item.commit?.message || '' : item.body || '';
  if (field === 'commits') {
    if (item.repository?.private || !item.sha) return null;
    return { sha:item.sha, parents:(item.parents || []).map(p=>({sha:p.sha})), author:item.author ? {login:item.author.login,type:item.author.type} : null,
      commit:{message:text.slice(0,1000),author:{date:item.commit?.author?.date}}, repo:item.repository?.full_name, url:item.html_url, textTruncated:text.length>1000 };
  }
  return { title:(item.title || '').slice(0,200), body:text.slice(0,1000), textTruncated:text.length>1000, url:item.html_url,
    state:item.state, comments:item.comments || 0, createdAt:item.created_at, merged:!!item.pull_request?.merged_at };
}
function startField(s, field) {
  s.phase=field;
  s[field]={total:0,sampled:0,incomplete:false,items:[],requests:0,limited:false};
  s.windows=[{from:s.since,to:s.startedAt.slice(0,10),page:1}];
}
async function next(state, {github, ai, now, githubId}) {
  const s=JSON.parse(JSON.stringify(state));
  if (s.phase==='profile') {
    const p=await github('/users/'+s.account);
    if (p.type!=='User') throw new Error('unsupportedAccount');
    if (normalizeAccount(p.login)!==s.account) throw new Error('notFound');
    if (String(p.id)!==String(githubId)) throw new Error('identityChanged');
    if (!Number.isFinite(Date.parse(p.created_at)) || Date.parse(p.created_at)>now) throw new Error('github');
    s.kind='User'; s.createdAt=p.created_at; s.since=p.created_at.slice(0,10); s.phase='repos';
  } else if (s.phase==='repos') {
    if (s.page>100) throw new Error('tooLarge');
    const rows=await github('/users/'+s.account+'/repos?type=owner&sort=full_name&direction=asc&per_page=100&page='+s.page);
    if (!Array.isArray(rows)) throw new Error('github');
    const seen=new Set(s.repositories.map(r=>r.name.toLowerCase()));
    rows.filter(r=>!r.private && r.owner?.login?.toLowerCase()===s.account).forEach(r=>{
      if (!seen.has(r.full_name.toLowerCase())) {s.repositories.push(compactRepo(r));seen.add(r.full_name.toLowerCase());}
    });
    s.page++;
    if (rows.length<100) {s.repositoriesComplete=true;startField(s,'commits');}
  } else if (['commits','prs','issues'].includes(s.phase)) {
    const field=s.phase, bucket=s[field], w=s.windows[0];
    const q='author:'+s.account+' is:public '+(field==='commits' ? 'author-date:' : 'is:'+(field==='prs'?'pr':'issue')+' created:')+w.from+'..'+w.to;
    const result=await github('/search/'+(field==='commits'?'commits':'issues')+'?q='+encodeURIComponent(q)+'&sort='+(field==='commits'?'author-date':'created')+'&order=asc&per_page=100&page='+w.page);
    if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total_count) || result.total_count<0) throw new Error('github');
    if (bucket.requests++===0) bucket.total=result.total_count;
    // Search exposes only 1,000 hits per query. Split non-overlapping UTC days first.
    if (w.page===1 && (result.total_count>1000 || result.incomplete_results) && w.from<w.to) {
      const mid=Math.floor((Date.parse(w.from)/DAY+Date.parse(w.to)/DAY)/2)*DAY;
      s.windows.splice(0,1,{from:w.from,to:day(mid),page:1},{from:day(mid+DAY),to:w.to,page:1});
    } else {
      if (result.incomplete_results || result.total_count>1000) bucket.incomplete=true;
      const seen=new Set(bucket.items.map(x=>field==='commits'?x.sha:x.url));
      for (const row of result.items) {
        const item=compact(row,field), key=item && (field==='commits'?item.sha:item.url);
        if (item && !seen.has(key) && bucket.items.length<LIMIT) {
          const bytes=Buffer.byteLength(JSON.stringify(item));
          if((s.activityBytes || 0)+bytes>BYTE_LIMIT) {bucket.limited=true;bucket.incomplete=true;break;}
          s.activityBytes=(s.activityBytes || 0)+bytes;bucket.items.push(item);seen.add(key);
        }
      }
      bucket.sampled=bucket.items.length;
      if (w.page*100>=Math.min(result.total_count,1000) || result.items.length<100) {
        if (result.items.length<100 && w.page*100<Math.min(result.total_count,1000)) bucket.incomplete=true;
        s.windows.shift();
      } else w.page++;
    }
    // Explicit operational ceiling; never label capped or timed-out search as complete.
    if ((bucket.limited || bucket.items.length>=LIMIT || bucket.requests>=1000) && s.windows.length) {bucket.limited=true;bucket.incomplete=true;s.windows=[];}
    if (!s.windows.length) {
      if (bucket.sampled<bucket.total) bucket.incomplete=true;
      if (field==='issues') {s.phase='ai';delete s.windows;} else startField(s,field==='commits'?'prs':'issues');
    }
  } else if (s.phase==='ai') {
    if (!s.report) {
      s.report=buildReport(s,now);
      delete s.commits;delete s.prs;delete s.issues;delete s.repositories;
    }
    const result=await summarize(s.report,ai,s.review,now);
    if (result.done) {s.report.ai=result.ai;s.report.scannedAt=new Date(now).toISOString();s.phase='done';delete s.review;}
    else s.review=result.review;
  }
  return s;
}
function buildReport(s, now) {
  const score=scoreRepository(s.account+'/account',s.commits.items);delete score.repo;
  const commits=new Map(s.commits.items.map(c=>[c.sha,c]));
  for (const metric of score.metrics) metric.evidence=metric.evidence.map(e=>({...e,url:commits.get(e.sha).url,repo:commits.get(e.sha).repo}));
  const languages={};s.repositories.filter(r=>!r.fork && r.language).forEach(r=>{languages[r.language]=(languages[r.language] || 0)+1;});
  const coverage={repositoriesComplete:!!s.repositoriesComplete};
  for(const f of ['commits','prs','issues']) {const {total,sampled,incomplete,limited}=s[f];coverage[f]={total,sampled,incomplete,limited};}
  return {...score,version:VERSION,account:s.account,kind:s.kind,createdAt:s.createdAt,since:s.since,until:s.startedAt.slice(0,10),scannedAt:new Date(now).toISOString(),
    repositories:s.repositories,repositoryStats:{total:s.repositories.length,original:s.repositories.filter(r=>!r.fork).length,archived:s.repositories.filter(r=>r.archived).length,stars:s.repositories.reduce((n,r)=>n+r.stars,0),languages},
    coverage,commits:s.commits.items,prs:s.prs.items,issues:s.issues.items};
}
export {normalizeAccount,begin,next};
