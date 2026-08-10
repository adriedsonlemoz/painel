import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

const INTEGRATIONS_BASE=`${import.meta.env.VITE_API_URL||'/api'}/admin/integracoes`
const API=(path,options={})=>fetch(`${INTEGRATIONS_BASE}${path}`,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.erro||'Falha na operação');return d})
const providers=[['cloudinary','Cloudinary'],['github','GitHub'],['groq','Groq (IA padrão)'],['anthropic','Anthropic'],['openai','OpenAI'],['gemini','Gemini'],['openrouter','OpenRouter'],['custom','Provedor personalizado']]
const blank={secret:'',metadata:{cloudName:'',apiKey:'',user:'',organization:'',repository:'',branch:'main',apiUrl:'',model:'',maxTokens:1000,temperature:.7,enabled:true}}

const integrationHelp={
 mongodb:{
  title:'Conexão principal do sistema',
  text:'Use MongoDB Atlas na nuvem ou uma instalação MongoDB Community/VPS. A URI precisa existir localmente para o backend alcançar o banco antes de carregar as demais configurações.',
  steps:['No Atlas, crie/abra seu cluster.','Crie um Database User e configure a IP Access List.','Clique em Connect → Drivers e copie a connection string.','Substitua <password> pela senha do usuário do banco e informe o nome do banco abaixo.'],
  links:[
   ['Criar conta no MongoDB Atlas','https://www.mongodb.com/cloud/atlas/register'],
   ['Como conectar a um cluster Atlas','https://www.mongodb.com/docs/atlas/connect-to-database-deployment/'],
  ],
  expected:'mongodb+srv://usuario:senha@cluster.../ ou mongodb://...',
 },
 cloudinary:{
  title:'Imagens e mídia',
  text:'O Cloudinary armazena imagens e outros arquivos de mídia usados pelo portal.',
  steps:['Entre no Cloudinary Console.','Abra Settings → API Keys.','Copie Cloud Name, API Key e API Secret.','Cole os três campos abaixo e use Testar antes de salvar em produção.'],
  links:[
   ['Abrir API Keys do Cloudinary','https://console.cloudinary.com/app/settings/api-keys'],
   ['Documentação: encontrar credenciais','https://cloudinary.com/documentation/finding_your_credentials_tutorial'],
  ],
  expected:'Cloud Name + API Key + API Secret',
 },
 groq:{
  title:'IA padrão do AL Sistemas',
  text:'Groq é o provedor padrão do assistente interno. A chave é usada para acessar os modelos disponíveis na GroqCloud.',
  steps:['Entre ou crie uma conta na GroqCloud.','Abra API Keys.','Clique em Create API Key e dê um nome como “AL Sistemas”.','Copie a chave uma única vez e cole abaixo.'],
  links:[
   ['Criar/gerenciar chaves Groq','https://console.groq.com/keys'],
   ['Quickstart oficial da Groq','https://console.groq.com/docs/quickstart'],
  ],
  expected:'gsk_...',
 },
 anthropic:{
  title:'IA alternativa — Claude',
  text:'Use uma chave Anthropic quando quiser operar o assistente com Claude em vez de Groq.',
  steps:['Entre no Claude Platform.','Abra Settings → API Keys.','Crie uma nova chave para o AL Sistemas.','Copie e cole a chave abaixo.'],
  links:[['Abrir API Keys da Anthropic','https://console.anthropic.com/settings/keys']],
  expected:'sk-ant-...',
 },
 openai:{
  title:'Integração OpenAI',
  text:'Armazena uma chave da OpenAI para módulos que venham a usar a API da plataforma.',
  steps:['Entre na OpenAI Platform.','Abra a área de API Keys.','Crie uma nova secret key para este projeto.','Copie a chave e salve aqui; ela não será exibida novamente integralmente.'],
  links:[['Abrir API Keys da OpenAI','https://platform.openai.com/settings/organization/api-keys']],
  expected:'chave secreta da OpenAI',
 },
 gemini:{
  title:'Google Gemini',
  text:'Permite armazenar uma Gemini API key gerada pelo Google AI Studio.',
  steps:['Entre no Google AI Studio.','Abra Get API key / API Keys.','Crie ou selecione um projeto e gere a chave.','Copie a chave e cole abaixo.'],
  links:[['Criar/gerenciar Gemini API Key','https://aistudio.google.com/app/apikey']],
  expected:'API key do Google AI Studio',
 },
 openrouter:{
  title:'OpenRouter',
  text:'O OpenRouter dá acesso a diversos modelos por uma única API compatível com autenticação Bearer.',
  steps:['Entre no OpenRouter.','Abra Settings → Keys.','Crie uma API key normal para chamadas de modelos.','Não use uma Management API Key aqui; ela serve apenas para administrar outras chaves.'],
  links:[
   ['Abrir chaves do OpenRouter','https://openrouter.ai/settings/keys'],
   ['Autenticação oficial','https://openrouter.ai/docs/api_reference/authentication'],
  ],
  expected:'sk-or-...',
 },
 custom:{
  title:'Provedor personalizado',
  text:'Use uma API própria ou compatível com autenticação Bearer. Como cada serviço é diferente, consulte a documentação oficial do provedor escolhido.',
  steps:['Obtenha uma chave/token no seu provedor.','Informe a URL completa da API.','Defina o modelo, se o serviço exigir.','Use Testar para validar a resposta antes de depender da integração.'],
  links:[],
  expected:'token + URL da API',
 },
}

export default function AdminIntegracoes(){
 const [status,setStatus]=useState(null),[tab,setTab]=useState('mongodb'),[form,setForm]=useState(blank),[mongo,setMongo]=useState({uri:'',databaseName:''}),[busy,setBusy]=useState(false),[diag,setDiag]=useState(null),[exportSecrets,setExportSecrets]=useState(false),[exporting,setExporting]=useState(false)
 const [github,setGithub]=useState({loading:false,account:null,repositories:[],diagnostics:null,preferences:{repository:'',branch:'main'}})
 const [identityRefreshing,setIdentityRefreshing]=useState(false)
 const load=()=>API('/status').then(d=>{setStatus(d);return d}).catch(e=>{toast.error(e.message);throw e})
 const refreshIdentities=async(silent=false)=>{setIdentityRefreshing(true);try{await API('/identities/refresh',{method:'POST'});await load();if(!silent)toast.success('Contas/origens atualizadas')}catch(e){if(!silent)toast.error(e.message)}finally{setIdentityRefreshing(false)}}
 useEffect(() => { load().then(()=>refreshIdentities(true)).catch(()=>{}) }, [])
 const save=async()=>{setBusy(true);try{if(tab==='mongodb')await API('/mongodb',{method:'PUT',body:JSON.stringify(mongo)});else await API(`/${tab}`,{method:'PUT',body:JSON.stringify(form)});toast.success('Configuração salva com segurança');setForm(blank);setMongo(m=>({...m,uri:''}));load()}catch(e){toast.error(e.message)}finally{setBusy(false)}}
 const test=async()=>{setBusy(true);try{const d=tab==='mongodb'?await API('/mongodb/test',{method:'POST',body:JSON.stringify(mongo)}):await API(`/${tab}/test`,{method:'POST'});toast.success(d.mensagem||'Conexão validada')}catch(e){toast.error(e.message)}finally{setBusy(false)}}
 const loadGithub=async()=>{setGithub(g=>({...g,loading:true}));try{const d=await API('/github/repositories');setGithub({loading:false,account:d.account,repositories:d.repositories||[],diagnostics:d.diagnostics||null,preferences:d.preferences||{repository:'',branch:'main'}})}catch(e){setGithub(g=>({...g,loading:false}));if(status?.integrations?.github?.configured)toast.error(e.message)}}
 useEffect(()=>{if(tab==='github'&&status?.integrations?.github?.configured)loadGithub()},[tab,status?.integrations?.github?.configured])
 const connectGithub=async()=>{if(!form.secret.trim())return toast.error('Cole o token do GitHub primeiro.');setBusy(true);try{const d=await API('/github/connect',{method:'POST',body:JSON.stringify({token:form.secret})});setGithub({loading:false,account:d.account,repositories:d.repositories||[],diagnostics:d.diagnostics||null,preferences:d.preferences||{repository:'',branch:'main'}});setForm(blank);toast.success(d.mensagem||'GitHub conectado');await load()}catch(e){toast.error(e.message)}finally{setBusy(false)}}
 const saveGithubPreferences=async()=>{setBusy(true);try{const d=await API('/github/preferences',{method:'PUT',body:JSON.stringify(github.preferences)});setGithub(g=>({...g,preferences:d.preferences}));toast.success(d.mensagem)}catch(e){toast.error(e.message)}finally{setBusy(false)}}
 const remove=async()=>{setBusy(true);try{await API(tab==='mongodb'?'/mongodb':`/${tab}`,{method:'DELETE'});toast.success('Configuração removida');load()}catch(e){toast.error(e.message)}finally{setBusy(false)}}
 const generate=async()=>{const d=await API('/password/generate',{method:'POST'});await navigator.clipboard.writeText(d.password);toast.success('Senha forte gerada e copiada')}
 const runDiag=async()=>{setBusy(true);try{setDiag(await API('/diagnostics/run'))}catch(e){toast.error(e.message)}finally{setBusy(false)}}
 const exportConfig=async(format='env')=>{setExporting(true);try{const r=await fetch(`${INTEGRATIONS_BASE}/export`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({includeSecrets:exportSecrets,format})});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.erro||'Falha ao exportar configurações')}const blob=await r.blob();const cd=r.headers.get('content-disposition')||'';const match=cd.match(/filename=\"?([^\";]+)\"?/i);const name=match?.[1]||`al-sistemas-integracoes.${format==='json'?'json':'env'}`;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);toast.success(exportSecrets?'Backup com segredos baixado. Guarde-o em local privado.':'Arquivo de referência baixado com valores mascarados.')}catch(e){toast.error(e.message)}finally{setExporting(false)}}
 const current=tab==='mongodb'?status?.mongodb:status?.integrations?.[tab]
 return <div className="adm-page integrations-page" style={{color:'var(--adm-text)'}}>
  <div style={{display:'flex',justifyContent:'space-between',gap:16,flexWrap:'wrap',alignItems:'center'}}><div><h1 style={{margin:0,fontSize:28}}>Integrações e APIs</h1><p style={{color:'var(--adm-muted)'}}>Credenciais criptografadas, testes de conexão e diagnóstico centralizado.</p></div><button onClick={runDiag} disabled={busy} className="adm-btn">Executar diagnóstico</button></div>
  <section style={{...card,marginBottom:18}}><div style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'flex-start',flexWrap:'wrap'}}><div><h2 style={{margin:'0 0 5px'}}>Backup das integrações</h2><div style={{fontSize:13,color:'var(--adm-muted)',lineHeight:1.5,maxWidth:720}}>Baixe um arquivo compatível com <code>.env</code> ou JSON com MongoDB, GitHub, Cloudinary, provedores de IA e Vercel configurados. Por padrão os valores ficam mascarados.</div></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={()=>exportConfig('env')} disabled={exporting}>{exporting?'Gerando…':'Baixar .env'}</button><button onClick={()=>exportConfig('json')} disabled={exporting}>Baixar JSON</button></div></div><label style={{display:'flex',gap:9,alignItems:'flex-start',marginTop:14,fontSize:13,cursor:'pointer'}}><input type="checkbox" checked={exportSecrets} onChange={e=>setExportSecrets(e.target.checked)} style={{width:'auto',marginTop:2}}/><span><b>Incluir valores secretos no backup</b><div style={{color:'var(--adm-muted)',marginTop:2}}>Use apenas para migração/recuperação. O arquivo conterá tokens e a URI real do banco e deve ser tratado como senha.</div></span></label></section>
  <section style={{...card,marginBottom:18}}>
   <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}><div><h2 style={{margin:'0 0 4px'}}>Contas e origens detectadas</h2><div style={{fontSize:13,color:'var(--adm-muted)'}}>O AL Sistemas consulta o que cada API permite identificar. Nem todo provedor expõe o e-mail do dono da chave.</div></div><button onClick={()=>refreshIdentities(false)} disabled={identityRefreshing}>{identityRefreshing?'Identificando…':'Atualizar identificação'}</button></div>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:9,marginTop:14}}>
    <IdentityBox name="MongoDB" identity={status?.mongodb?.identity} configured={status?.mongodb?.configured}/>
    {providers.map(([id,label])=><IdentityBox key={id} name={label} identity={status?.integrations?.[id]?.metadata?.identity} configured={status?.integrations?.[id]?.configured}/>) }
    <IdentityBox name="Vercel" identity={status?.vercel?.identity} configured={status?.vercel?.configured}/>
   </div>
  </section>
  <div style={{display:'grid',gridTemplateColumns:'minmax(190px,240px) 1fr',gap:18}} className="integrations-grid">
   <aside style={card}>{[['mongodb','Banco de dados'],...providers].map(([id,label])=><button key={id} onClick={()=>{setTab(id);setForm(blank)}} style={{...navBtn,background:tab===id?'var(--adm-surface2)':'transparent',color:tab===id?'var(--adm-text)':'var(--adm-muted)'}}>{label}<span style={{marginLeft:'auto'}}>{(id==='mongodb'?status?.mongodb?.configured:status?.integrations?.[id]?.configured)?'●':'○'}</span></button>)}<button onClick={generate} style={{...navBtn,marginTop:12}}>Gerar senha segura</button></aside>
   <main style={card}><div className="integration-card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}><h2 style={{marginTop:0}}>{tab==='mongodb'?'MongoDB':providers.find(x=>x[0]===tab)?.[1]}</h2><span>{current?.locked?'⚠️ Chave incompatível':current?.configured?'Configurado':'Não configurado'} {current?.connected===true?'• conectado':''}</span></div>
    <IntegrationInstructions info={integrationHelp[tab]}/>
    {tab!=='github'&&<IdentityDetail identity={tab==='mongodb'?current?.identity:current?.metadata?.identity} configured={current?.configured}/>}
    {current?.locked&&<div style={{padding:12,borderRadius:10,border:'1px solid #f59e0b55',background:'#f59e0b12',marginBottom:14,fontSize:13,lineHeight:1.5}}><b>Credencial existente, mas bloqueada</b><div style={{marginTop:4,color:'var(--adm-muted)'}}>Ela foi criptografada por outra instalação. Digite uma nova chave e clique em salvar/conectar para substituí-la. O registro antigo não impede mais a troca.</div></div>}
    {tab==='mongodb'?<><div className="integration-status-grid" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:9,marginBottom:14}}>
      <StatusBox label="Estado" value={current?.connected?'Conectado':current?.configured?'Configurado / desconectado':'Não configurado'}/>
      <StatusBox label="Tipo" value={current?.provider==='atlas'?'MongoDB Atlas':current?.provider||'—'}/>
      <StatusBox label="Banco" value={current?.database||'—'}/>
      <StatusBox label="Servidor" value={current?.host||'—'}/>
    </div>
    <Field label="URL de conexão" type="password" value={mongo.uri} onChange={v=>setMongo({...mongo,uri:v})} placeholder={current?.configured?'••••••••••••••••':'mongodb+srv://usuario:senha@cluster/...'} />
    <Field label="Nome do banco" value={mongo.databaseName} onChange={v=>setMongo({...mongo,databaseName:v})} placeholder={current?.database||'alsistemas'}/>
    {current?.persistentConfigPath&&<div style={{fontSize:12,color:'var(--adm-muted)',marginTop:-4}}>Cofre local persistente: <code>{current.persistentConfigPath}</code></div>}
    </>:tab==='github'?<GitHubConnector current={current} form={form} setForm={setForm} github={github} setGithub={setGithub} busy={busy} onConnect={connectGithub} onReload={loadGithub} onSavePreferences={saveGithubPreferences}/>:<><Field label={tab==='cloudinary'?'API Secret':tab==='groq'?'Groq API Key':'Chave / token da API'} type="password" value={form.secret} onChange={v=>setForm({...form,secret:v})} placeholder={current?.configured?'••••••••••••••••':tab==='groq'?'gsk_...':tab==='anthropic'?'sk-ant-...':tab==='openrouter'?'sk-or-...':'Cole a credencial'}/>{tab==='cloudinary'&&<><Field label="Cloud Name" value={form.metadata.cloudName} onChange={v=>setForm({...form,metadata:{...form.metadata,cloudName:v}})} placeholder="ex.: meu-cloud"/><Field label="API Key" value={form.metadata.apiKey} onChange={v=>setForm({...form,metadata:{...form.metadata,apiKey:v}})} placeholder="API Key do Console"/></>}{!['cloudinary','github','groq'].includes(tab)&&<><Field label="URL da API" value={form.metadata.apiUrl} onChange={v=>setForm({...form,metadata:{...form.metadata,apiUrl:v}})}/><Field label="Modelo padrão" value={form.metadata.model} onChange={v=>setForm({...form,metadata:{...form.metadata,model:v}})}/><Field label="Limite de tokens" type="number" value={form.metadata.maxTokens} onChange={v=>setForm({...form,metadata:{...form.metadata,maxTokens:Number(v)}})}/><Field label="Temperatura" type="number" value={form.metadata.temperature} onChange={v=>setForm({...form,metadata:{...form.metadata,temperature:Number(v)}})}/></>}</>}
    {tab!=='github'&&<div style={{display:'flex',gap:10,marginTop:20,flexWrap:'wrap'}}><button onClick={save} disabled={busy}>{tab==='mongodb'?'Salvar e reconectar':'Salvar com segurança'}</button><button onClick={test} disabled={busy}>{tab==='mongodb'?'Testar conexão':'Testar'}</button><button onClick={remove} disabled={busy}>{tab==='mongodb'?'Remover conexão local':'Remover'}</button></div>}
    {tab==='github'&&current?.configured&&<div style={{display:'flex',gap:10,marginTop:18,flexWrap:'wrap'}}><button onClick={test} disabled={busy}>Verificar conexão</button><button onClick={remove} disabled={busy}>Desconectar GitHub</button></div>}
   </main>
  </div>{diag&&<section style={{...card,marginTop:18}}><h2>Diagnóstico</h2>{diag.checks.map(c=><div key={c.name} style={{padding:'9px 0',borderBottom:'1px solid var(--adm-border)'}}>{c.ok?'✅':'⚠️'} <b>{c.name}</b> — {c.detail||'OK'}</div>)}</section>}
  <style>{`
    @media(max-width:760px){
      .integrations-grid{grid-template-columns:1fr!important;gap:14px!important}
      .integration-card-header{align-items:flex-start!important;flex-wrap:wrap}
      .integration-card-header h2{margin-bottom:0}
      .github-diagnostic-grid,.integration-status-grid{grid-template-columns:1fr!important}
      .integration-help-links{display:grid!important;grid-template-columns:1fr}
      .integration-help-links a{text-align:center}
    }
    input{width:100%;box-sizing:border-box;padding:11px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-bg);color:var(--adm-text)}
    button{padding:10px 14px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-surface2);color:var(--adm-text);cursor:pointer}
  `}</style>
 </div>
}


function IdentityBox({name,identity,configured}){
 const text=!configured?'Não configurada':identity?.available?(identity.email||identity.username||identity.label):identity?.note||identity?.label||'Identidade não exposta pela API'
 return <div style={{padding:11,borderRadius:10,border:'1px solid var(--adm-border)',background:'var(--adm-bg)',minWidth:0}}><div style={{fontSize:11,fontWeight:800}}>{name}</div><div style={{fontSize:12,color:'var(--adm-muted)',marginTop:4,overflowWrap:'anywhere'}}>{text}</div>{identity?.email&&identity?.username&&<div style={{fontSize:11,color:'var(--adm-muted)',marginTop:3}}>@{identity.username}</div>}</div>
}
function IdentityDetail({identity,configured}){
 if(!configured)return null
 return <div style={{padding:12,borderRadius:10,border:'1px solid var(--adm-border)',background:'var(--adm-surface2)',marginBottom:14,fontSize:13,lineHeight:1.5}}><b>Conta/origem identificada</b>{identity?.available?<><div style={{marginTop:5}}>{identity.email||identity.username||identity.label}</div>{identity?.email&&identity?.username&&<div style={{fontSize:12,color:'var(--adm-muted)'}}>@{identity.username}</div>}{identity?.note&&<div style={{fontSize:12,color:'var(--adm-muted)',marginTop:4}}>{identity.note}</div>}</>:<div style={{fontSize:12,color:'var(--adm-muted)',marginTop:5}}>{identity?.note||identity?.label||'Esta API não disponibiliza ao AL Sistemas o e-mail do proprietário da chave.'}</div>}</div>
}

function StatusBox({label,value}){return <div style={{padding:10,borderRadius:9,border:'1px solid var(--adm-border)',background:'var(--adm-bg)',minWidth:0}}><div style={{fontSize:10,color:'var(--adm-muted)',fontWeight:800}}>{label.toUpperCase()}</div><div style={{marginTop:3,fontSize:13,fontWeight:700,overflowWrap:'anywhere'}}>{value}</div></div>}

function IntegrationInstructions({info}){
 if(!info)return null
 return <div className="integration-help" style={{padding:13,borderRadius:10,border:'1px solid var(--adm-border)',background:'var(--adm-surface2)',marginBottom:14,fontSize:13,lineHeight:1.5}}>
  <b>{info.title}</b>
  <div style={{color:'var(--adm-muted)',marginTop:4}}>{info.text}</div>
  {!!info.steps?.length&&<ol style={{margin:'10px 0 0',paddingLeft:20,color:'var(--adm-text)'}}>{info.steps.map((step,i)=><li key={i} style={{margin:'4px 0'}}>{step}</li>)}</ol>}
  {info.expected&&<div style={{marginTop:9,fontSize:12,color:'var(--adm-muted)'}}><b>Formato/dados esperados:</b> <code>{info.expected}</code></div>}
  {!!info.links?.length&&<div className="integration-help-links" style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>{info.links.map(([label,url])=><a key={url} href={url} target="_blank" rel="noreferrer" style={{display:'inline-block',padding:'7px 9px',borderRadius:8,border:'1px solid var(--adm-border)',background:'var(--adm-bg)',color:'var(--adm-accent)',fontWeight:700,textDecoration:'none'}}>{label} ↗</a>)}</div>}
 </div>
}

function GitHubConnector({current,form,setForm,github,setGithub,busy,onConnect,onReload,onSavePreferences}){
 const d=github.diagnostics
 const selected=github.preferences?.repository||''
 return <div>
  <div style={{padding:14,borderRadius:10,border:'1px solid var(--adm-border)',background:'var(--adm-surface2)',marginBottom:16,fontSize:13,lineHeight:1.55}}>
   <strong>Token recomendado para o AL Sistemas</strong>
   <div style={{marginTop:6,color:'var(--adm-muted)'}}>Como este painel pode publicar arquivos e, futuramente, administrar repositórios, use um <b>Personal Access Token (classic)</b> dedicado ao AL Sistemas.</div>
   <div style={{marginTop:8}}><b>Para publicar/editar arquivos:</b> marque <b>repo</b> (repositórios privados e públicos) ou <b>public_repo</b> se você trabalhar exclusivamente com repositórios públicos.</div>
   <div style={{marginTop:5}}><b>Somente se quiser permitir apagar repositórios pelo painel:</b> marque também <b>delete_repo</b>. Essa permissão é poderosa e não é necessária para atualizar o site.</div>
   <div style={{marginTop:5}}><b>Workflows:</b> marque <b>workflow</b> apenas se o AL Sistemas precisar criar ou alterar arquivos em <code>.github/workflows/</code>.</div>
   <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer" style={{display:'inline-block',marginTop:10,color:'var(--adm-accent)',fontWeight:700}}>Criar Personal Access Token (classic) ↗</a>
   <div style={{marginTop:7}}><a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" style={{color:'var(--adm-accent)'}}>Gerenciar tokens classic ↗</a></div>
  </div>

  <Field label={current?.configured?'Novo token (somente se quiser trocar)':'Personal Access Token'} type="password" value={form.secret} onChange={v=>setForm({...form,secret:v})} placeholder={current?.configured?'ghp_••••••••••••':'ghp_...'}/>
  <div style={{fontSize:12,color:'var(--adm-muted)',marginTop:-7,marginBottom:14}}>Para esta integração administrativa, prefira um token classic que começa com <b>ghp_</b>. Fine-grained (<b>github_pat_</b>) continua aceito, mas precisa ter permissões explícitas suficientes para cada operação. O token nunca é devolvido ao navegador depois de salvo.</div>
  <button onClick={onConnect} disabled={busy||!form.secret.trim()} style={{fontWeight:700}}>{busy?'Conectando…':current?.configured?'Testar e trocar token':'Testar e conectar'}</button>

  {current?.configured&&<div style={{marginTop:18}}>
   <div style={{padding:14,borderRadius:10,border:'1px solid var(--adm-border)',background:'var(--adm-surface2)'}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}>
     <div>
      <strong>{github.account?.login?`✓ Conectado como @${github.account.login}`:'✓ Token salvo no cofre'}</strong>
      {github.account?.name&&<div style={{fontSize:12,color:'var(--adm-muted)',marginTop:3}}>{github.account.name}</div>}
      {github.account?.email&&<div style={{fontSize:12,color:'var(--adm-muted)',marginTop:3}}>E-mail: <b>{github.account.email}</b></div>}
     </div>
     <button onClick={onReload} disabled={github.loading||busy}>{github.loading?'Consultando…':'Atualizar repositórios'}</button>
    </div>
    {d&&<div className="github-diagnostic-grid" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8,marginTop:14}}>
      <Diag ok={d.tokenValid} text="Token válido"/>
      <Diag ok={d.accountDetected} text="Conta identificada"/>
      <Diag ok={d.repositoryRead} text={`${d.repositoryCount||0} repositório(s) acessível(is)`}/>
      <Diag ok={d.repositoryWrite} text={`${d.writableRepositoryCount||0} com escrita pela conta`}/>
    </div>}
   </div>

   <div style={{marginTop:16}}>
    <label style={{display:'block',fontSize:13,fontWeight:600}}>Repositório padrão <span style={{fontWeight:400,color:'var(--adm-muted)'}}>(opcional)</span>
     <select value={selected} onChange={e=>setGithub(g=>({...g,preferences:{...g.preferences,repository:e.target.value}}))} style={{marginTop:6,width:'100%',boxSizing:'border-box',padding:11,borderRadius:8,border:'1px solid var(--adm-border)',background:'var(--adm-bg)',color:'var(--adm-text)'}}>
      <option value="">Nenhum — perguntar quando eu usar</option>
      {github.repositories.map(r=><option key={r.id} value={r.fullName}>{r.fullName}{r.private?' • privado':''}{r.permissions?.write?' • escrita':''}</option>)}
     </select>
    </label>
    <div style={{fontSize:12,color:'var(--adm-muted)',marginTop:6}}>Deixar vazio não limita o GitHub. O AL Sistemas poderá mostrar e usar todos os repositórios que <b>o próprio token</b> autorizar. A permissão <b>Contents: Read and write</b> é confirmada de fato pelo GitHub quando uma operação de gravação for executada.</div>
   </div>

   <div style={{marginTop:13}}>
    <Field label="Branch padrão" value={github.preferences?.branch||'main'} onChange={v=>setGithub(g=>({...g,preferences:{...g.preferences,branch:v}}))} placeholder="main"/>
   </div>
   <button onClick={onSavePreferences} disabled={busy||github.loading}>Salvar preferências</button>

   {github.repositories.length>0&&<details style={{marginTop:16}}>
    <summary style={{cursor:'pointer',fontWeight:700}}>Ver repositórios acessíveis ({github.repositories.length})</summary>
    <div style={{marginTop:8,maxHeight:280,overflow:'auto',borderTop:'1px solid var(--adm-border)'}}>
     {github.repositories.map(r=><div key={r.id} style={{padding:'10px 2px',borderBottom:'1px solid var(--adm-border)',display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
      <span><b>{r.fullName}</b> {r.private?'🔒':''}</span>
      <span style={{fontSize:12,color:r.permissions?.write?'var(--adm-accent)':'var(--adm-muted)'}}>{r.permissions?.write?'conta pode escrever':'somente leitura'}</span>
     </div>)}
    </div>
   </details>}
  </div>}
 </div>
}
function Diag({ok,text}){return <div style={{fontSize:12,padding:'7px 9px',borderRadius:8,background:'var(--adm-bg)',border:'1px solid var(--adm-border)'}}>{ok?'✅':'⚠️'} {text}</div>}

function Field({label,onChange,...props}){return <label style={{display:'block',marginBottom:13,fontSize:13,fontWeight:600}}>{label}<input {...props} onChange={e=>onChange(e.target.value)} style={{marginTop:6}} autoComplete="new-password"/></label>}
const card={background:'var(--adm-surface)',border:'1px solid var(--adm-border)',borderRadius:14,padding:18}; const navBtn={width:'100%',display:'flex',border:0,padding:'11px 10px',background:'transparent',textAlign:'left'}
