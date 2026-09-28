// Browser contract fixture; durable behavior is separately tested against real MySQL.
export async function mockChat(page, {answer='Saved reply', failFirst=false, holdAfter=Infinity}={}) {
  const conversations=[], turns=new Map(), payloads=[];
  let calls=0;
  function generate(turn) {
    calls++;
    turn.status=failFirst && calls===1?'failed':calls>=holdAfter?'running':'completed';
    if(turn.status==='completed')turn.messages.push({id:crypto.randomUUID(),role:'assistant',content:answer});
  }
  await page.route('**/api/pig-king/chat/conversations**', route=>{
    const request=route.request(), url=new URL(request.url()), parts=url.pathname.split('/').slice(5), method=request.method();
    const body=method==='GET'||method==='DELETE'?{}:request.postDataJSON();
    let result={ok:true};
    const conversation=conversations.find(c=>c.id===parts[0]);
    if(!parts.length || !parts[0]) {
      if(method==='POST'){const c={id:body.id,title:'New chat',revision:'1',state:'active',updatedAt:''};conversations.push(c);turns.set(c.id,[]);result={conversation:c};}
      else result={items:conversations.filter(c=>c.state===(url.searchParams.get('state')||'active')),cursor:null};
    } else if(parts[1]==='turns') {
      const items=turns.get(parts[0]);
      if(parts.length===2 && method==='GET')result={conversation,items,before:null};
      else if(parts.length===2){
        payloads.push(body);const turn={id:crypto.randomUUID(),turnNo:String(items.length+1),attempt:1,status:'pending',messages:[{id:crypto.randomUUID(),role:'user',content:body.content}]};
        items.push(turn);conversation.title=items[0].messages[0].content;generate(turn);result={turn:{id:turn.id}};
      }else{const turn=items.find(t=>t.id===parts[2]);if(parts[3]==='cancel')turn.status='cancelled';else{turn.attempt++;generate(turn);}}
    } else if(method==='PATCH'){Object.assign(conversation,body);conversation.revision=String(Number(conversation.revision)+1);result={conversation};}
    else if(method==='DELETE'){conversations.splice(conversations.indexOf(conversation),1);turns.delete(conversation.id);}
    return route.fulfill({json:result});
  });
  return {payloads};
}
