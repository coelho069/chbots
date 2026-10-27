// Interface web mobile servida em GET / (sem auth: só o shell estático; os dados vêm de /api/* com Bearer).
export const WEB_UI = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>CH BOTS</title>
<style>
body{margin:0;font:16px system-ui;background:#111;color:#eee}
header{display:flex;gap:6px;padding:8px;background:#1b1b1b;position:sticky;top:0;overflow-x:auto}header button{white-space:nowrap;flex:none}
button,input,textarea{font:inherit;padding:10px;border-radius:8px;border:1px solid #444;background:#222;color:#eee}
button.on{background:#2d6cdf}main{padding:12px}
.item{padding:12px;margin:8px 0;background:#1b1b1b;border-radius:8px;overflow-wrap:anywhere}
.u{background:#243a63}textarea,select{width:100%;box-sizing:border-box;margin:4px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}iframe{width:100%;height:70vh;border:1px solid #444;background:#fff}.err{color:#f88}small{color:#999}
#msgs{min-height:40vh}#send{display:flex;gap:6px}#send input{flex:1}
</style></head><body><div id="app"><main><h2>CH BOTS</h2><input type="password" placeholder="Cole o token" style="width:100%;box-sizing:border-box"><p><button type="button">Entrar</button></p><p id="boot"><small>Carregando… (precisa de JavaScript)</small></p></main></div>
<script>window.onerror=function(m,s,l,c){var d=document.createElement('pre');d.style.cssText='color:#f55;white-space:pre-wrap;padding:12px';d.textContent='ERRO: '+m+' @'+l+':'+c;document.body.appendChild(d)}</script>
<script>
const $=document.getElementById('app'),tk=()=>{try{return localStorage.getItem('tk')||''}catch(_){return ''}}
const el=(t,p,...k)=>{const e=document.createElement(t);Object.assign(e,p||{});e.append(...k);return e}
async function api(p,o={}){const r=await fetch(p,{...o,headers:{...o.headers,'Content-Type':'application/json',Authorization:'Bearer '+tk()}})
if(r.status===401){localStorage.removeItem('tk');login();throw new Error('401')}
if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||r.status);return r}
const get=async p=>(await api(p)).json()
function login(){const i=el('input',{type:'password',placeholder:'Cole o token',style:'width:100%;box-sizing:border-box'})
$.replaceChildren(el('main',0,el('h2',0,'CH BOTS'),i,el('p'),el('button',{textContent:'Entrar',onclick:async()=>{localStorage.setItem('tk',i.value.trim());try{await get('/api/agents');shell()}catch(_){}}})))}
const tabs={Agentes:agents,Fluxos:flows,Rotinas:routines,'Caixa-Preta':runs,Prompts:prompts,MCP:mcp,Pages:pages,'Memória':mem,'Config':cfg}
function shell(){const m=el('main'),h=el('header');
for(const n in tabs)h.append(el('button',{textContent:n,onclick:e=>{[...h.children].forEach(b=>b.classList.remove('on'));e.target.classList.add('on');m.replaceChildren();tabs[n](m).catch(x=>m.append(el('p',{className:'err',textContent:String(x)})))}}))
h.append(el('button',{textContent:'Sair',onclick:()=>{localStorage.removeItem('tk');login()}}));$.replaceChildren(h,m);h.children[0].click()}
const list=(m,rows,f)=>rows.length?rows.forEach(r=>m.append(el('div',{className:'item'},...f(r)))):m.append(el('p',0,'Nada aqui.'))
async function agents(m){m.replaceChildren(el('button',{textContent:'+ Novo agente',onclick:()=>agentForm(m,null)}));list(m,await get('/api/agents'),a=>[el('b',0,a.name),el('br'),el('small',0,a.model+' · temp '+a.temperature),el('p'),el('button',{textContent:'Conversar',onclick:()=>chat(m,a)}),el('button',{textContent:'Editar',onclick:()=>agentForm(m,a)}),el('button',{textContent:'Excluir',onclick:async()=>{if(confirm('Excluir '+a.name+'?')){await api('/api/agents/'+a.id,{method:'DELETE'});tabs.Agentes(m)}}})])}
async function agentForm(m,a){const ps=await get('/api/providers'),n=el('input',{placeholder:'Nome',value:a?a.name:''}),pv=el('select'),md=el('input',{placeholder:'Modelo',value:a?a.model:''}),t=el('input',{type:'number',step:'0.1',min:'0',max:'2',value:a?a.temperature:0.7}),sp=el('textarea',{rows:8,placeholder:'System prompt',value:a?a.systemPrompt:''}),e=el('p',{className:'err'})
for(const p of ps)pv.append(el('option',{value:p.id,textContent:p.name,selected:!!a&&a.providerId===p.id}))
for(const i of [n,md,t]){i.style.width='100%';i.style.boxSizing='border-box'}
m.replaceChildren(el('h3',0,a?'Editar agente':'Novo agente'),n,pv,md,t,sp,e,el('button',{textContent:'Salvar',onclick:async()=>{try{await api(a?'/api/agents/'+a.id:'/api/agents',{method:a?'PUT':'POST',body:JSON.stringify({name:n.value,providerId:+pv.value,model:md.value,temperature:+t.value,systemPrompt:sp.value})});tabs.Agentes(m)}catch(x){e.textContent=String(x)}}}),el('button',{textContent:'Cancelar',onclick:()=>tabs.Agentes(m)}))}
async function chat(m,a){const msgs=el('div',{id:'msgs'}),i=el('input',{placeholder:'Mensagem'}),
c=await (await api('/api/conversations',{method:'POST',body:JSON.stringify({agentId:a.id})})).json()
const add=(cls,t)=>{const d=el('div',{className:'item '+cls,textContent:t});msgs.append(d);return d}
const f=el('form',{id:'send',onsubmit:async e=>{e.preventDefault();const t=i.value.trim();if(!t)return;i.value='';add('u',t);const b=add('','…')
try{const r=await api('/api/conversations/'+c.id+'/chat',{method:'POST',body:JSON.stringify({text:t})}),rd=r.body.getReader(),dec=new TextDecoder();let buf='',txt=''
for(;;){const{value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});const parts=buf.split('\\n\\n');buf=parts.pop()
for(const p of parts){if(!p.startsWith('data: '))continue;const j=JSON.parse(p.slice(6));if(j.delta){txt+=j.delta;b.textContent=txt}if(j.type==='error')b.textContent=j.error}}}
catch(x){b.textContent=String(x)}}},i,el('button',{textContent:'Enviar'}))
m.replaceChildren(el('h3',0,a.name),msgs,f)}
async function flows(m){list(m,await get('/api/flows'),x=>{const s=el('small');return[el('b',0,x.name),el('br'),el('small',0,x.nodeCount+' nós'+(x.schedule?' · '+x.schedule:'')),el('p'),el('button',{textContent:'Executar',onclick:async()=>{try{await api('/api/flows/'+x.id+'/run',{method:'POST',body:'{}'});s.textContent=' iniciado'}catch(e){s.textContent=' '+e.message}}}),el('button',{textContent:'Execuções',onclick:()=>flowRuns(m,x)}),s]})}
async function flowRuns(m,x){m.replaceChildren(el('h3',0,x.name),el('button',{textContent:'← Voltar',onclick:()=>tabs.Fluxos(m)}));list(m,await get('/api/flows/'+x.id+'/runs'),r=>[el('b',0,'#'+r.id+' '+r.status),el('br'),el('small',0,r.startedAt+' · '+r.trigger),...(r.error?[el('p',{className:'err',textContent:r.error})]:[]),el('p'),el('button',{textContent:'Detalhe',onclick:()=>runSteps(m,r,()=>flowRuns(m,x))})])}
async function runSteps(m,r,back){m.replaceChildren(el('h3',0,'Execução #'+r.id+' · '+r.status),el('button',{textContent:'← Voltar',onclick:back}));list(m,await get('/api/flow-runs/'+r.id+'/steps'),p=>[el('b',0,p.nodeId+' · '+p.status),...(p.error?[el('p',{className:'err',textContent:p.error})]:[]),el('small',0,'Entrada'),el('pre',0,p.input||''),el('small',0,'Saída'),el('pre',0,p.output||'')])}
async function routines(m){list(m,await get('/api/routines'),r=>[el('b',0,r.name),el('br'),el('small',0,r.cron+(r.enabled?'':' (desativada)')),el('p'),el('button',{textContent:'Execuções',onclick:async()=>{m.replaceChildren(el('h3',0,r.name),el('button',{textContent:'← Voltar',onclick:()=>tabs.Rotinas(m)}));list(m,await get('/api/routine-runs/'+r.id),u=>[el('b',0,'#'+u.id+' '+u.status),el('br'),el('small',0,u.startedAt),...(u.error?[el('p',{className:'err',textContent:u.error})]:[])])}})])}
async function runs(m){list(m,await get('/api/blackbox'),r=>[el('b',0,r.nome),el('small',0,' '+r.tipo+' · '+r.status),el('br'),el('small',0,r.iniciadoEm),...(r.erro?[el('p',{className:'err',textContent:r.erro})]:[]),...(r.tipo==='fluxo'?[el('p'),el('button',{textContent:'Detalhe',onclick:()=>runSteps(m,{id:r.execucaoId,status:r.status},()=>tabs['Caixa-Preta'](m))})]:[])])}
async function mem(m){list(m,await get('/api/memoria/fatos'),f=>[el('p',0,f.fato),el('small',0,f.categoria+' · '+f.status)])}
async function prompts(m){list(m,await get('/api/prompts'),p=>[el('small',0,p.createdAt+' · '+p.chars+' caracteres'),el('p',0,p.originalIdea),el('pre',0,p.prompt),el('button',{textContent:'Copiar',onclick:()=>{try{navigator.clipboard.writeText(p.prompt)}catch(_){}}})])}
async function mcp(m){list(m,await get('/api/mcp/calls'),c=>[el('b',0,c.server_name+' / '+c.tool_name),el('small',0,' '+c.status+(c.duration_ms!=null?' · '+c.duration_ms+'ms':'')),el('br'),el('small',0,c.started_at),...(c.error?[el('p',{className:'err',textContent:c.error})]:[])])}
async function pages(m){list(m,await get('/api/pages'),g=>[el('b',0,g.title),el('br'),el('small',0,g.updatedAt),el('p'),el('button',{textContent:'Abrir',onclick:async()=>{const d=await get('/api/pages/'+g.id);m.replaceChildren(el('h3',0,d.title),el('button',{textContent:'← Voltar',onclick:()=>tabs.Pages(m)}),el('iframe',{sandbox:'',srcdoc:d.html}))}})])}
async function cfg(m){const c=await get('/api/settings'),n=el('input',{type:'checkbox',checked:c.notifyOnRun}),d=el('input',{type:'number',min:'0',value:c.retentionDays}),s=el('small')
m.replaceChildren(el('label',0,n,' Notificar ao executar'),el('p'),el('label',0,'Retenção (dias) ',d),el('p'),el('button',{textContent:'Salvar',onclick:async()=>{try{await api('/api/settings',{method:'POST',body:JSON.stringify({notifyOnRun:n.checked,retentionDays:+d.value})});s.textContent=' salvo'}catch(e){s.textContent=' '+e.message}}}),s)}
tk()?shell():login()
</script></body></html>`
