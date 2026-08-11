import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { authFetch } from '../../services/domains/http.js'

const INTEGRATIONS_BASE=`${import.meta.env.VITE_API_URL||'/api'}/admin/integracoes`
const API=(path,options={})=>authFetch(`${INTEGRATIONS_BASE}${path}`,{credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})},...options}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.erro||'Falha na operação');return d})
const providers=[['cloudinary','Cloudinary'],['cloudflare','Cloudflare'],['github','GitHub'],['render','Render'],['vercel','Vercel'],['gemini','Google Gemini'],['openrouter','OpenRouter'],['api_ninjas','API Ninjas · Horóscopo'],['api_football','API-Football · Futebol']]
const AI_PROVIDERS=['gemini','openrouter']
const API_DEFAULTS={gemini:'https://generativelanguage.googleapis.com/v1beta',openrouter:'https://openrouter.ai/api/v1'}
const blank={secret:'',secrets:{r2AccessKeyId:'',r2SecretAccessKey:''},metadata:{cloudName:'',apiKey:'',accountId:'',teamId:'',r2Bucket:'',r2PublicUrl:'',r2Endpoint:'',user:'',organization:'',repository:'',branch:'main',apiUrl:'',model:'',maxTokens:1200,temperature:.25,enabled:true,primary:false,systemInstructions:'Não invente fatos. Preserve nomes, datas, números e fontes. Responda em português do Brasil e siga o objetivo específico de cada módulo.',privacy:{githubLogs:true,vercelLogs:true,renderLogs:true,rssContent:true,readme:true,editorial:true,mongoDocuments:false},profiles:{},translatePtBr:true,leagueIds:'',maxMatches:6,showInternational:true,liveCacheSeconds:300}}

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
 cloudflare:{
  title:'Cloudflare — API + R2 em abas separadas',
  text:'A configuração fica em duas abas para não misturar credenciais: Cloudflare API mantém o token REST e o Account ID; R2 Storage guarda as credenciais S3 usadas nos objetos. Tudo continua salvo no mesmo cofre seguro do AL Sistemas.',
  steps:['Na aba Cloudflare API, mantenha o API Token da conta e o Account ID.','Na aba R2 Storage, informe Access Key ID + Secret Access Key criados em Manage R2 API Tokens.','O endpoint S3 é calculado automaticamente a partir do Account ID.','Não é obrigatório digitar bucket: depois de salvar, abra o módulo Cloudflare → R2 e escolha “Usar no AL”.','O backup .env de Integrações inclui as credenciais R2 quando a opção de incluir segredos estiver habilitada.'],
  links:[['Abrir painel Cloudflare','https://dash.cloudflare.com'],['Gerenciar API Tokens','https://dash.cloudflare.com/profile/api-tokens'],['Documentação de tokens R2','https://developers.cloudflare.com/r2/api/tokens/'],['API Cloudflare','https://developers.cloudflare.com/api/']],
  expected:'API Token + Account ID • R2 opcional: Access Key ID + Secret Access Key',
 },
 render:{
  title:'Render',
  text:'A chave da Render alimenta o módulo Infraestrutura → Plataformas. Serviços e deploys passam a usar esta credencial central; o ambiente fica apenas como fallback de compatibilidade.',
  steps:['Entre no Render Dashboard.','Abra Account Settings → API Keys.','Crie uma API key dedicada ao AL Sistemas.','Cole a chave abaixo, use Testar e depois Salvar.','Depois disso, o módulo Plataformas carrega serviços e deploys sem pedir a chave novamente.'],
  links:[['Abrir Render Dashboard','https://dashboard.render.com'],['Documentação oficial da API','https://api-docs.render.com/reference/authentication']],
  expected:'Render API Key criada nas configurações da conta',
 },
 vercel:{
  title:'Vercel',
  text:'O token da Vercel alimenta o módulo Infraestrutura → Plataformas para listar projetos e deploys. Configure uma vez aqui; os demais módulos apenas consomem a credencial central.',
  steps:['Entre na Vercel.','Abra Account Settings → Tokens e crie um Access Token.','Cole o token abaixo.','Se os projetos estiverem em uma Team, informe o Team ID; para conta pessoal deixe vazio.','Use Testar e depois Salvar.'],
  links:[['Criar token na Vercel','https://vercel.com/account/tokens'],['Documentação oficial da REST API','https://vercel.com/docs/rest-api']],
  expected:'Vercel Access Token • Team ID opcional',
 },
 gemini:{
  title:'Google Gemini',
  text:'O Gemini pode ser o cérebro principal do AL Sistemas: Assistente de IA, ferramentas do editor de notícias e enriquecimento opcional do RSS usam esta configuração. A chave fica protegida no cofre/MongoDB.',
  steps:['Entre no Google AI Studio.','Abra Get API key / API Keys.','Crie ou selecione um projeto e gere a chave.','Copie a chave e cole na etapa Credencial.','Teste a conexão e escolha se o Gemini será a IA principal do sistema.'],
  links:[['Criar/gerenciar Gemini API Key','https://aistudio.google.com/app/apikey']],
  expected:'API key do Google AI Studio • modelo recomendado: gemini-2.5-flash',
 },
 openrouter:{
  title:'OpenRouter',
  text:'O OpenRouter dá acesso a diversos modelos por uma única API. Para custo zero, use openrouter/free como modelo; ele escolhe automaticamente entre modelos gratuitos compatíveis.',
  steps:['Entre no OpenRouter.','Abra Settings → Keys.','Crie uma API key normal para chamadas de modelos.','Não use uma Management API Key aqui; ela serve apenas para administrar outras chaves.'],
  links:[
   ['Abrir chaves do OpenRouter','https://openrouter.ai/settings/keys'],
   ['Autenticação oficial','https://openrouter.ai/docs/api_reference/authentication'],
  ],
  expected:'sk-or-...',
 },
 api_ninjas:{
  title:'API Ninjas — Horóscopo',
  text:'Fornece o horóscopo diário usado no portal. A chave fica somente no backend e o bloco da Home só aparece quando estiver ativado nos Módulos da Home.',
  steps:['Crie uma conta no API Ninjas.','Abra a área da API Key.','Cole a chave abaixo e use Testar.','O AL pode traduzir o texto para pt-BR usando Gemini/OpenRouter já configurados.'],
  links:[['Documentação oficial do Horóscopo','https://api-ninjas.com/api/horoscope']],
  expected:'X-Api-Key do API Ninjas',
 },
 api_football:{
  title:'API-Football — placares e jogos',
  text:'Alimenta Futebol ao vivo e Jogos de hoje. O AL consulta a API apenas pelo backend e aplica cache para proteger a cota.',
  steps:['Crie/abra sua conta API-Sports.','Copie a API key do dashboard.','Cole a chave e use Testar.','Opcionalmente informe IDs de ligas separados por vírgula para limitar a Home.'],
  links:[['Documentação oficial API-Football','https://www.api-football.com/documentation-v3']],
  expected:'API key enviada no header x-apisports-key',
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
 const [status,setStatus]=useState(null),[tab,setTab]=useState(null),[form,setForm]=useState(blank),[mongo,setMongo]=useState({uri:'',databaseName:''}),[busy,setBusy]=useState(false),[diag,setDiag]=useState(null),[aiDiag,setAiDiag]=useState(null),[aiUsage,setAiUsage]=useState(null),[exportSecrets,setExportSecrets]=useState(false),[exporting,setExporting]=useState(false),[utility,setUtility]=useState(null),[importFile,setImportFile]=useState(null),[importing,setImporting]=useState(false)
 const [github,setGithub]=useState({loading:false,account:null,repositories:[],diagnostics:null,preferences:{repository:'',branch:'main'}})
 const [identityRefreshing,setIdentityRefreshing]=useState(false)
 const [integrationTest,setIntegrationTest]=useState(null)
 const load=()=>API('/status').then(d=>{setStatus(d);return d}).catch(e=>{toast.error(e.message);throw e})
 const refreshIdentities=async(silent=false)=>{setIdentityRefreshing(true);try{await API('/identities/refresh',{method:'POST'});await load();if(!silent)toast.success('Contas/origens atualizadas')}catch(e){if(!silent)toast.error(e.message)}finally{setIdentityRefreshing(false)}}
 useEffect(() => { load().then(()=>refreshIdentities(true)).catch(()=>{}) }, [])
 const save=async()=>{setBusy(true);try{if(tab==='mongodb')await API('/mongodb',{method:'PUT',body:JSON.stringify(mongo)});else await API(`/${tab}`,{method:'PUT',body:JSON.stringify(form)});toast.success('Configuração salva com segurança');setForm(blank);setMongo(m=>({...m,uri:''}));load()}catch(e){toast.error(e.message)}finally{setBusy(false)}}
 const test=async()=>{setBusy(true);setIntegrationTest(null);try{const d=tab==='mongodb'?await API('/mongodb/test',{method:'POST',body:JSON.stringify(mongo)}):await API(`/${tab}/test`,{method:'POST',body:JSON.stringify({secret:form.secret,secrets:form.secrets,metadata:form.metadata})});setIntegrationTest(d);toast.success(d.mensagem||'Conexão validada')}catch(e){setIntegrationTest({ok:false,erro:e.message});toast.error(e.message)}finally{setBusy(false)}}
 const loadGithub=async()=>{setGithub(g=>({...g,loading:true}));try{const d=await API('/github/repositories');setGithub({loading:false,account:d.account,repositories:d.repositories||[],diagnostics:d.diagnostics||null,preferences:d.preferences||{repository:'',branch:'main'}})}catch(e){setGithub(g=>({...g,loading:false}));if(status?.integrations?.github?.configured)toast.error(e.message)}}
 useEffect(()=>{if(tab==='github'&&status?.integrations?.github?.configured)loadGithub()},[tab,status?.integrations?.github?.configured])
 const connectGithub=async()=>{if(!form.secret.trim())return toast.error('Cole o token do GitHub primeiro.');setBusy(true);try{const d=await API('/github/connect',{method:'POST',body:JSON.stringify({token:form.secret})});setGithub({loading:false,account:d.account,repositories:d.repositories||[],diagnostics:d.diagnostics||null,preferences:d.preferences||{repository:'',branch:'main'}});setForm(blank);toast.success(d.mensagem||'GitHub conectado');await load()}catch(e){toast.error(e.message)}finally{setBusy(false)}}
 const saveGithubPreferences=async()=>{setBusy(true);try{const d=await API('/github/preferences',{method:'PUT',body:JSON.stringify(github.preferences)});setGithub(g=>({...g,preferences:d.preferences}));toast.success(d.mensagem)}catch(e){toast.error(e.message)}finally{setBusy(false)}}
 const remove=async()=>{setBusy(true);try{await API(tab==='mongodb'?'/mongodb':`/${tab}`,{method:'DELETE'});toast.success('Configuração removida');load()}catch(e){toast.error(e.message)}finally{setBusy(false)}}
 const generate=async()=>{const d=await API('/password/generate',{method:'POST'});await navigator.clipboard.writeText(d.password);toast.success('Senha forte gerada e copiada')}
 const runDiag=async()=>{setBusy(true);try{setDiag(await API('/diagnostics/run'))}catch(e){toast.error(e.message)}finally{setBusy(false)}}
 const runAiDiag=async()=>{setBusy(true);setAiDiag(null);try{const [d,u]=await Promise.all([API('/ai/diagnostics'),API('/ai/usage?days=7').catch(()=>null)]);setAiDiag(d);setAiUsage(u);setUtility('ai-diagnostics');toast.success(d.ok?'IA validada':'Diagnóstico concluído com alertas')}catch(e){setAiDiag(e?.data||{ok:false,status:e.message,providers:[]});setUtility('ai-diagnostics');toast.error(e.message)}finally{setBusy(false)}}
 const exportConfig=async(format='env')=>{setExporting(true);try{const r=await authFetch(`${INTEGRATIONS_BASE}/export`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({includeSecrets:exportSecrets,format})});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.erro||'Falha ao exportar configurações')}const blob=await r.blob();const cd=r.headers.get('content-disposition')||'';const match=cd.match(/filename=\"?([^\";]+)\"?/i);const name=match?.[1]||`al-sistemas-integracoes.${format==='json'?'json':'env'}`;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);toast.success(exportSecrets?'Backup com segredos baixado. Guarde-o em local privado.':'Arquivo de referência baixado com valores mascarados.')}catch(e){toast.error(e.message)}finally{setExporting(false)}}
 const openIntegration=(id)=>{setTab(id);setForm(blank);setIntegrationTest(null)}
 const closeIntegration=()=>{setTab(null);setForm(blank);setMongo(m=>({...m,uri:''}));setIntegrationTest(null)}
 const parseEnv=(text)=>Object.fromEntries(text.replace(/^\uFEFF/,'').split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#')&&x.includes('=')).map(line=>{const i=line.indexOf('=');let v=line.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1).replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\\\/g,'\\');return [line.slice(0,i).trim(),v]}))
 const importConfig=async()=>{if(!importFile)return toast.error('Escolha um arquivo .env ou .json.');setImporting(true);try{const text=await importFile.text();let variables={};if(importFile.name.toLowerCase().endsWith('.json')){const data=JSON.parse(text);variables=data.variables||data}else variables=parseEnv(text);const d=await API('/import',{method:'POST',body:JSON.stringify({variables})});toast.success(d.mensagem||'Configurações importadas');setUtility(null);setImportFile(null);await load()}catch(e){toast.error(e.message)}finally{setImporting(false)}}
 const current=tab==='mongodb'?status?.mongodb:(tab?status?.integrations?.[tab]:null)
 useEffect(()=>{ if(tab==='mongodb'||tab==='github')return; const m=status?.integrations?.[tab]?.metadata||{}; setForm(f=>({...blank,secret:'',metadata:{...blank.metadata,apiUrl:API_DEFAULTS[tab]||'',...m}})) },[tab,status])
 return <div className="adm-page integrations-page" style={{color:'var(--adm-text)'}}>
  <div className="integrations-titlebar"><div><div className="eyebrow">CONFIGURAÇÃO CENTRAL</div><h1>Integrações e APIs</h1><p>Abra somente o serviço que deseja configurar. Nada fica espalhado ou aberto abaixo da página.</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={runAiDiag} disabled={busy}>Diagnóstico da IA</button><button onClick={runDiag} disabled={busy}>Diagnóstico geral</button></div></div>

  <section className="utility-strip">
   <div><b>Ferramentas de configuração</b><span>Backup, restauração e utilitários sem ocupar a tela.</span></div>
   <div className="utility-actions"><button onClick={()=>setUtility('export')}>⇩ Exportar</button><button onClick={()=>setUtility('import')}>⇧ Importar</button><button onClick={generate}>✦ Gerar senha</button></div>
  </section>

  <section className="integration-hub">
   <div className="hub-heading"><div><div className="eyebrow">SUAS CONEXÕES</div><h2>Escolha uma integração</h2><p>Grade adaptável: três cards no desktop, dois no tablet e um no celular, sem apertar o conteúdo.</p></div><button onClick={()=>refreshIdentities(false)} disabled={identityRefreshing}>{identityRefreshing?'Atualizando…':'Atualizar status'}</button></div>
   <div className="integration-card-grid">
    <IntegrationCard id="mongodb" name="MongoDB" description="Banco principal do AL Sistemas e origem das configurações persistidas." status={status?.mongodb} onOpen={openIntegration}/>
    <IntegrationCard id="cloudinary" name="Cloudinary" description="Hospedagem de imagens e mídia publicadas no portal." status={status?.integrations?.cloudinary} onOpen={openIntegration}/>
    <IntegrationCard id="cloudflare" name="Cloudflare" description="DNS, zonas, segurança e armazenamento R2 usado também pelos Projetos." status={status?.integrations?.cloudflare} onOpen={openIntegration}/>
    <IntegrationCard id="github" name="GitHub" description="Publicação, repositórios e fluxo de atualização do projeto." status={status?.integrations?.github} onOpen={openIntegration}/>
    <IntegrationCard id="render" name="Render" description="Serviços, deploys e acompanhamento da hospedagem Render." status={status?.integrations?.render} onOpen={openIntegration}/>
    <IntegrationCard id="vercel" name="Vercel" description="Projetos e deploys hospedados na Vercel, usando uma única credencial central." status={status?.integrations?.vercel} onOpen={openIntegration}/>
    <IntegrationCard id="gemini" name="Google Gemini" description="IA para Assistente, editor de notícias e recursos opcionais do RSS." status={status?.integrations?.gemini} onOpen={openIntegration}/>
    <IntegrationCard id="openrouter" name="OpenRouter" description="Provedor alternativo de IA com acesso unificado a vários modelos." status={status?.integrations?.openrouter} onOpen={openIntegration}/>
    <IntegrationCard id="api_ninjas" name="Horóscopo" description="API Ninjas para o horóscopo diário exibido no portal." status={status?.integrations?.api_ninjas} onOpen={openIntegration}/>
    <IntegrationCard id="api_football" name="Futebol" description="API-Football para jogos ao vivo e partidas do dia." status={status?.integrations?.api_football} onOpen={openIntegration}/>
   </div>
  </section>

  {tab&&<Modal title={tab==='mongodb'?'MongoDB':providers.find(x=>x[0]===tab)?.[1]} subtitle={current?.locked?'Credencial incompatível':current?.configured?'Configurado':'Não configurado'} onClose={closeIntegration}>
    <IntegrationInstructions info={integrationHelp[tab]}/>
    {tab!=='github'&&<IdentityDetail identity={tab==='mongodb'?current?.identity:current?.metadata?.identity} configured={current?.configured}/>} 
    {current?.locked&&<div className="warning-box"><b>Credencial existente, mas bloqueada</b><div>Ela foi criptografada por outra instalação. Digite uma nova chave para substituí-la.</div></div>}
    {tab==='mongodb'?<><div className="integration-status-grid">
      <StatusBox label="Estado" value={current?.connected?'Conectado':current?.configured?'Configurado / desconectado':'Não configurado'}/><StatusBox label="Tipo" value={current?.provider==='atlas'?'MongoDB Atlas':current?.provider||'—'}/><StatusBox label="Banco" value={current?.database||'—'}/><StatusBox label="Servidor" value={current?.host||'—'}/>
     </div><SecretField label="URL de conexão" value={mongo.uri} onChange={v=>setMongo({...mongo,uri:v})} placeholder={current?.configured?'Digite somente para substituir':'mongodb+srv://usuario:senha@cluster/...'}/><Field label="Nome do banco" value={mongo.databaseName} onChange={v=>setMongo({...mongo,databaseName:v})} placeholder={current?.database||'alsistemas'}/></>
     :tab==='github'?<GitHubConnector current={current} form={form} setForm={setForm} github={github} setGithub={setGithub} busy={busy} onConnect={connectGithub} onReload={loadGithub} onSavePreferences={saveGithubPreferences}/>
     :tab==='cloudflare'?<CloudflareConnector current={current} form={form} setForm={setForm} diagnostic={integrationTest}/>
     :tab==='render'?<RenderConnector current={current} form={form} setForm={setForm}/>
     :tab==='vercel'?<VercelConnector current={current} form={form} setForm={setForm}/>
     :AI_PROVIDERS.includes(tab)?<AIWizard provider={tab} form={form} setForm={setForm} current={current}/>
     :['api_ninjas','api_football'].includes(tab)?<PortalApiConnector provider={tab} current={current} form={form} setForm={setForm}/>
     :<><SecretField label="API Secret" value={form.secret} onChange={v=>setForm({...form,secret:v})} placeholder={current?.configured?'Digite somente para substituir':'Cole a credencial'}/>{tab==='cloudinary'&&<><Field label="Cloud Name" value={form.metadata.cloudName} onChange={v=>setForm({...form,metadata:{...form.metadata,cloudName:v}})} placeholder="ex.: meu-cloud"/><Field label="API Key" value={form.metadata.apiKey} onChange={v=>setForm({...form,metadata:{...form.metadata,apiKey:v}})} placeholder="API Key do Console"/></>}</>}
    <div className="modal-actions">
     {tab!=='github'&&<><button className="primary" onClick={save} disabled={busy}>{busy?'Salvando…':tab==='mongodb'?'Salvar e reconectar':'Salvar'}</button><button onClick={test} disabled={busy}>Testar</button></>}
     {tab==='github'&&current?.configured&&<button onClick={test} disabled={busy}>Verificar conexão</button>}
     {current?.configured&&<button className="danger" onClick={remove} disabled={busy}>{tab==='github'?'Desconectar':'Remover'}</button>}
     <button onClick={closeIntegration}>Fechar</button>
    </div>
  </Modal>}

  {utility==='export'&&<Modal title="Exportar configurações" subtitle="Escolha o formato e o nível de segurança" onClose={()=>setUtility(null)}>
   <p className="modal-copy">Crie um arquivo para referência, migração ou recuperação do AL Sistemas.</p>
   <div className="choice-grid"><button onClick={()=>exportConfig('env')} disabled={exporting}><b>.ENV</b><span>Ideal para servidor e configuração manual.</span></button><button onClick={()=>exportConfig('json')} disabled={exporting}><b>JSON</b><span>Ideal para backup e futura reimportação.</span></button></div>
   <label className="secret-option"><input type="checkbox" checked={exportSecrets} onChange={e=>setExportSecrets(e.target.checked)}/><span><b>Incluir valores secretos</b><small>Inclui tokens, chaves e URI real do MongoDB. Use apenas para migração ou recuperação.</small></span></label>
   <div className="modal-actions"><button onClick={()=>setUtility(null)}>Fechar</button></div>
  </Modal>}

  {utility==='import'&&<Modal title="Importar configurações" subtitle="Restaurar um backup do AL Sistemas" onClose={()=>setUtility(null)}>
   <p className="modal-copy">Aceita arquivos <b>.json</b> ou <b>.env</b> exportados por esta área. Valores mascarados são ignorados para não apagar credenciais válidas.</p>
   <label className="file-drop"><input type="file" accept=".json,.env,application/json,text/plain" onChange={e=>setImportFile(e.target.files?.[0]||null)}/><b>{importFile?.name||'Escolher arquivo'}</b><span>{importFile?'Arquivo pronto para importar.':'Toque para selecionar seu backup.'}</span></label>
   <div className="modal-actions"><button className="primary" onClick={importConfig} disabled={importing||!importFile}>{importing?'Importando…':'Importar agora'}</button><button onClick={()=>setUtility(null)}>Cancelar</button></div>
  </Modal>}


  {utility==='ai-diagnostics'&&<Modal title="Diagnóstico da IA" subtitle="Motor central · fila, fallback, JSON validado e telemetria" onClose={()=>setUtility(null)}>
   <div className={`ai-diagnostic-summary ${aiDiag?.ok?'ok':'warn'}`}><b>{aiDiag?.ok?'✓ IA operacional':'⚠ IA precisa de atenção'}</b><span>{aiDiag?.status||'Diagnóstico indisponível'}</span>{aiDiag?.principal&&<small>Principal: {aiDiag.principal.nome} · {aiDiag.principal.modelo}</small>}</div>
   <div className="ai-runtime-metrics"><StatusBox label="Fila agora" value={`${aiDiag?.queue?.active||0} ativa(s) · ${aiDiag?.queue?.pending||0} aguardando`}/><StatusBox label="Concorrência" value={`${aiDiag?.queue?.concurrency||2}`}/><StatusBox label="Timeout por chamada" value={`${Math.round((aiDiag?.timeoutMs||0)/1000)} s`}/><StatusBox label="Tempo máximo operação" value={`${Math.round((aiDiag?.operationTimeoutMs||0)/1000)} s`}/></div>
   <div className="ai-diagnostic-list">{(aiDiag?.providers||[]).map(p=><div key={p.id} className="ai-diagnostic-provider"><div><b>{p.nome}</b><span>{p.model||p.modelo||'—'}</span></div><strong className={p.ok?'ok':'warn'}>{p.ok?'Funcionando':p.configured?'Com problema':'Não configurado'}</strong><p>{p.status}</p>{p.configured&&<div className="ai-diagnostic-tests"><span>{p.structuredOk===true?'✓ JSON estruturado':p.structuredOk===false?'✕ JSON estruturado':'○ Teste rápido'}</span>{p.latencyMs!=null&&<span>{p.latencyMs} ms</span>}{p.circuitOpen&&<span>Cooldown {Math.ceil((p.retryAfterMs||0)/1000)} s</span>}</div>}</div>)}</div>
   {aiUsage&&<><h3 style={{fontSize:13,margin:'16px 0 8px'}}>Uso nos últimos 7 dias</h3><div className="ai-runtime-metrics"><StatusBox label="Solicitações" value={aiUsage.total||0}/><StatusBox label="Sucesso" value={aiUsage.success||0}/><StatusBox label="Fallbacks" value={aiUsage.fallbacks||0}/><StatusBox label="Erros" value={aiUsage.errors||0}/><StatusBox label="Cache" value={aiUsage.cacheHits||0}/><StatusBox label="Latência média" value={`${Math.round(aiUsage.avgLatencyMs||0)} ms`}/><StatusBox label="Tokens" value={`${(aiUsage.inputTokens||0)+(aiUsage.outputTokens||0)}`}/><StatusBox label="Custo informado" value={`$${Number(aiUsage.costUsd||0).toFixed(4)}`}/></div></>}
   <p className="modal-copy" style={{marginTop:12}}>O diagnóstico profundo usa uma única geração estruturada por provedor. O health normal não consome geração a cada atualização do Dashboard.</p>
   <div className="modal-actions"><button className="primary" onClick={runAiDiag} disabled={busy}>{busy?'Testando…':'Testar novamente'}</button><button onClick={async()=>{await API('/ai/runtime/reset',{method:'POST',body:'{}'});toast.success('Cooldowns reiniciados');runAiDiag()}}>Liberar cooldown</button><button onClick={()=>setUtility(null)}>Fechar</button></div>
  </Modal>}

  {diag&&<section style={{...card,marginTop:18}}><h2>Diagnóstico</h2>{diag.checks.map(c=><div key={c.name} style={{padding:'9px 0',borderBottom:'1px solid var(--adm-border)'}}>{c.ok?'✅':'⚠️'} <b>{c.name}</b> — {c.detail||'OK'}</div>)}</section>}
  <style>{`
    .integrations-titlebar,.hub-heading{display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap}.integrations-titlebar h1,.hub-heading h2{margin:4px 0 6px}.integrations-titlebar p,.hub-heading p,.modal-copy{margin:0;color:var(--adm-muted);font-size:13px;line-height:1.5}.eyebrow{font-size:10px;font-weight:900;letter-spacing:.11em;color:var(--adm-accent)}
    .utility-strip{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:18px 0;padding:14px 16px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-surface)}.utility-strip>div:first-child{display:flex;flex-direction:column;gap:3px}.utility-strip span{font-size:12px;color:var(--adm-muted)}.utility-actions{display:flex;gap:8px;flex-wrap:wrap}
    .integration-hub{padding:18px;border:1px solid var(--adm-border);border-radius:16px;background:var(--adm-surface)}.integration-card-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:18px}.big-integration-card{min-width:0;min-height:132px;padding:16px;border:1px solid var(--adm-border);border-radius:14px;background:var(--adm-bg);text-align:left;display:flex;flex-direction:column;align-items:stretch;transition:.18s ease}.big-integration-card:hover{transform:translateY(-1px);border-color:var(--adm-accent)}.big-integration-card .card-top{display:flex;align-items:center;gap:9px}.big-integration-card .dot{width:10px;height:10px;border-radius:50%;background:var(--adm-border);flex:0 0 auto}.big-integration-card.connected .dot{background:var(--adm-accent)}.big-integration-card.paused .dot{background:var(--adm-muted)}.big-integration-card h3{font-size:15px;margin:0}.big-integration-card .state{margin-left:auto;font-size:10px;font-weight:900;color:var(--adm-muted)}.big-integration-card.connected .state{color:var(--adm-accent)}.big-integration-card p{font-size:12px;line-height:1.5;color:var(--adm-muted);margin:12px 0 0}.big-integration-card .open-label{margin-top:auto;padding-top:12px;font-size:11px;font-weight:800;color:var(--adm-accent)}
    .modal-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center;padding:16px}.integration-modal{width:min(760px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.28)}.modal-head{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:16px 18px;border-bottom:1px solid var(--adm-border);background:var(--adm-surface)}.modal-head h2{margin:0;font-size:20px}.modal-head span{font-size:11px;color:var(--adm-muted)}.modal-close{padding:7px 10px;font-size:18px;line-height:1}.modal-body{padding:18px}.modal-actions{position:sticky;bottom:-18px;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin:20px -18px -18px;padding:14px 18px;border-top:1px solid var(--adm-border);background:var(--adm-surface)}.modal-actions .primary{border-color:var(--adm-accent);color:var(--adm-accent);font-weight:800}.modal-actions .danger{color:#d9534f}.warning-box{padding:12px;border-radius:10px;border:1px solid #f59e0b55;background:#f59e0b12;margin-bottom:14px;font-size:13px}.warning-box div{margin-top:4px;color:var(--adm-muted)}
    .cloudflare-config-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:5px;margin:0 0 14px;border:1px solid var(--adm-border);border-radius:12px;background:var(--adm-bg)}.cloudflare-config-tabs button{min-width:0;padding:9px 10px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--adm-muted);font-size:12px;font-weight:800}.cloudflare-config-tabs button.active{border-color:var(--adm-border);background:var(--adm-surface);color:var(--adm-text);box-shadow:0 1px 4px rgba(0,0,0,.08)}.cloudflare-tab-note{display:flex;gap:6px;align-items:flex-start;flex-direction:column;padding:11px 12px;border:1px dashed var(--adm-border);border-radius:10px;background:var(--adm-bg);font-size:11px;line-height:1.5;color:var(--adm-muted)}.cloudflare-tab-note>b{color:var(--adm-text);font-size:11px}
    .choice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:16px 0}.choice-grid button{text-align:left;padding:16px;display:flex;flex-direction:column;gap:5px}.choice-grid span{font-size:11px;color:var(--adm-muted);line-height:1.4}.secret-option{display:flex;gap:10px;align-items:flex-start;padding:13px;border:1px solid var(--adm-border);border-radius:12px;background:var(--adm-bg)}.secret-option input{width:auto;margin-top:3px}.secret-option span{display:flex;flex-direction:column;gap:4px}.secret-option small{color:var(--adm-muted);line-height:1.4}.file-drop{display:flex;flex-direction:column;gap:5px;margin-top:16px;padding:22px;border:1px dashed var(--adm-border);border-radius:14px;background:var(--adm-bg);text-align:center;cursor:pointer}.file-drop input{display:none}.file-drop span{font-size:12px;color:var(--adm-muted)}
    .integration-status-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-bottom:14px}.ai-steps{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;overflow:visible!important}.ai-steps button{min-width:0!important;overflow:hidden}.github-diagnostic-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    input{width:100%;box-sizing:border-box;padding:11px;border-radius:8px;border:1px solid var(--adm-border);background:var(--adm-bg);color:var(--adm-text)}button{padding:10px 14px;border-radius:9px;border:1px solid var(--adm-border);background:var(--adm-surface2);color:var(--adm-text);cursor:pointer}
    .ai-runtime-box{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid var(--adm-border);background:var(--adm-surface2);border-radius:12px;margin-bottom:14px}.ai-runtime-box>div{min-width:0;display:grid;gap:3px}.ai-runtime-box span{font-size:11px;color:var(--adm-muted)}.ai-runtime-pill{flex:none;padding:5px 8px;border-radius:999px;font-size:9px!important;font-weight:900;letter-spacing:.06em}.ai-runtime-pill.on{color:var(--adm-accent);border:1px solid color-mix(in srgb,var(--adm-accent) 40%,var(--adm-border))}.ai-runtime-pill.off{border:1px solid var(--adm-border)}
    .ai-api-readonly,.ai-note,.ai-review-callout{padding:11px 12px;border-radius:10px;border:1px solid var(--adm-border);background:var(--adm-surface2);font-size:12px;line-height:1.5;margin:10px 0 14px}.ai-api-readonly{display:grid;gap:4px}.ai-api-readonly code{overflow-wrap:anywhere;color:var(--adm-accent)}.ai-api-readonly span,.ai-note,.ai-review-callout span{color:var(--adm-muted)}
    .model-picker-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 0 8px}.model-picker-head button{font-size:11px}.ai-params-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .ai-toggle-row{display:flex;gap:10px;align-items:flex-start;padding:13px;border:1px solid var(--adm-border);border-radius:10px;margin:10px 0}.ai-toggle-row input{width:auto;margin-top:2px}.ai-toggle-row span{display:grid;gap:3px}.ai-toggle-row small{font-size:11px;font-weight:400;color:var(--adm-muted);line-height:1.45}.ai-toggle-row.disabled{opacity:.55}.ai-review-callout{display:grid;gap:4px;margin-top:14px}.ai-privacy{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2);margin-top:12px}.ai-privacy>b{grid-column:1/-1;font-size:12px}.ai-privacy label{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--adm-muted)}.ai-privacy input{width:auto}.ai-runtime-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0 14px}.ai-model-cap-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:10px 0}.ai-model-cap-list button{display:grid;gap:3px;text-align:left;padding:9px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-bg);color:var(--adm-text);min-width:0}.ai-model-cap-list button.selected{border-color:var(--adm-accent);background:color-mix(in srgb,var(--adm-accent) 7%,var(--adm-surface))}.ai-model-cap-list b{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ai-model-cap-list span,.ai-model-selected span{font-size:8.5px;line-height:1.35;color:var(--adm-muted)}.ai-model-selected{display:grid;gap:4px;padding:9px 10px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2);margin-bottom:10px}.ai-model-selected b{font-size:10px}
    @media(max-width:900px){.integration-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}

    .ai-diagnostic-summary{display:grid;gap:4px;padding:13px;border:1px solid var(--adm-border);border-radius:12px;background:var(--adm-bg);margin-bottom:12px}.ai-diagnostic-summary.ok b,.ai-diagnostic-provider strong.ok{color:#22c55e}.ai-diagnostic-summary.warn b,.ai-diagnostic-provider strong.warn{color:#f59e0b}.ai-diagnostic-summary span,.ai-diagnostic-summary small{color:var(--adm-muted);font-size:12px}.ai-diagnostic-list{display:grid;gap:9px}.ai-diagnostic-provider{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 10px;padding:12px;border:1px solid var(--adm-border);border-radius:12px;background:var(--adm-surface2)}.ai-diagnostic-provider>div:first-child{display:grid;gap:2px}.ai-diagnostic-provider>div:first-child span{font-size:11px;color:var(--adm-muted)}.ai-diagnostic-provider>strong{font-size:11px}.ai-diagnostic-provider p{grid-column:1/-1;margin:1px 0;color:var(--adm-muted);font-size:12px}.ai-diagnostic-tests{grid-column:1/-1!important;display:flex!important;flex-wrap:wrap;gap:6px!important}.ai-diagnostic-tests span{padding:4px 7px;border:1px solid var(--adm-border);border-radius:999px;font-size:10px!important;color:var(--adm-muted)}
    @media(max-width:620px){.integrations-titlebar>button,.hub-heading>button{width:100%}.utility-strip{align-items:stretch;flex-direction:column}.utility-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.utility-actions button{padding:9px 5px;font-size:11px}.integration-hub{padding:14px}.integration-card-grid{grid-template-columns:1fr;gap:9px}.big-integration-card{min-height:150px;padding:13px}.big-integration-card h3{font-size:13px}.big-integration-card p{font-size:11px}.modal-backdrop{padding:0;align-items:flex-end;justify-content:center}.integration-modal{border-radius:18px 18px 0 0;max-height:92dvh;width:100%}.modal-body{padding:15px}.modal-actions{margin:18px -15px -15px;padding:12px 15px;display:grid;grid-template-columns:1fr 1fr}.modal-actions button{width:100%}.choice-grid{grid-template-columns:1fr}.integration-status-grid,.github-diagnostic-grid{grid-template-columns:1fr}.integration-help-links{display:grid!important;grid-template-columns:1fr}.integration-help-links a{text-align:center}.ai-steps{grid-template-columns:repeat(2,minmax(0,1fr))!important}.ai-params-grid{grid-template-columns:1fr!important}.ai-privacy,.ai-runtime-metrics{grid-template-columns:1fr 1fr!important}.ai-model-cap-list{grid-template-columns:1fr!important}.model-picker-head{align-items:flex-start;flex-direction:column}.model-picker-head button{width:100%}.ai-steps button{font-size:11px;padding:9px 5px!important}}
  `}</style>
 </div>
}



function IntegrationCard({id,name,description,status,onOpen}){const configured=Boolean(status?.configured),isAi=AI_PROVIDERS.includes(id),enabled=status?.metadata?.enabled!==false;const state=!configured?'PENDENTE':isAi&&!enabled?'PAUSADO':isAi&&status?.metadata?.primary?'PRINCIPAL':isAi?'ATIVO':'CONFIGURADO';return <button className={`big-integration-card ${configured?'connected':''} ${isAi&&!enabled?'paused':''}`} onClick={()=>onOpen(id)}><div className="card-top"><span className="dot"/><h3>{name}</h3><span className="state">{state}</span></div><p>{description}</p>{isAi&&configured&&<small style={{color:'var(--adm-muted)',marginTop:8}}>Modelo: {status?.metadata?.model||(id==='gemini'?'gemini-2.5-flash':'openrouter/free')}</small>}<span className="open-label">Abrir configuração →</span></button>}
function Modal({title,subtitle,onClose,children}){return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="integration-modal" role="dialog" aria-modal="true" aria-label={title}><header className="modal-head"><div><h2>{title}</h2><span>{subtitle}</span></div><button className="modal-close" onClick={onClose} aria-label="Fechar">×</button></header><div className="modal-body">{children}</div></section></div>}
function ConnectionTile({name,status}){
 const configured=!!status?.configured, identity=status?.identity||status?.metadata?.identity
 const detail=identity?.available?(identity.email||identity.username||identity.label):(configured?(identity?.label||'Credencial protegida no cofre'):'Aguardando configuração')
 return <div style={{padding:14,borderRadius:13,border:`1px solid ${configured?'color-mix(in srgb, var(--adm-accent) 35%, var(--adm-border))':'var(--adm-border)'}`,background:'var(--adm-bg)'}}><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{width:9,height:9,borderRadius:99,background:configured?'var(--adm-accent)':'var(--adm-border)'}}/><b style={{fontSize:13}}>{name}</b><span style={{marginLeft:'auto',fontSize:10,fontWeight:900,color:configured?'var(--adm-accent)':'var(--adm-muted)'}}>{configured?'CONECTADO':'PENDENTE'}</span></div><div style={{fontSize:11,color:'var(--adm-muted)',marginTop:8,overflowWrap:'anywhere'}}>{detail}</div></div>
}

function AIWizard({provider,form,setForm,current}){
 const [step,setStep]=useState(1),[models,setModels]=useState([]),[modelsBusy,setModelsBusy]=useState(false)
 useEffect(()=>{setStep(1);setModels([])},[provider])
 const gemini=provider==='gemini', name=gemini?'Google Gemini':'OpenRouter', defaultUrl=API_DEFAULTS[provider]
 const setMeta=(key,value)=>setForm(f=>({...f,metadata:{...f.metadata,[key]:value}}))
 const loadModels=async()=>{setModelsBusy(true);try{const d=await API(`/${provider}/models`,{method:'POST',body:JSON.stringify({secret:form.secret})});setModels(d.models||[]);toast.success(`${d.count||d.models?.length||0} modelo(s) encontrado(s)`) }catch(e){toast.error(e.message)}finally{setModelsBusy(false)}}
 const active=form.metadata.enabled!==false
 const selectedModel=models.find(m=>m.id===form.metadata.model)||null
 return <div>
  <div className="ai-runtime-box"><div><b>Como este provedor entra no sistema</b><span>{active?(form.metadata.primary?'IA principal • será tentada primeiro':'IA alternativa • entra automaticamente se a principal falhar'):'Desativado • não será usado pelo Assistente, Notícias ou RSS'}</span></div><span className={`ai-runtime-pill ${active?'on':'off'}`}>{active?'ATIVO':'PAUSADO'}</span></div>
  <div className="ai-steps" style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:7,marginBottom:18}}>{[['1','Credencial'],['2','Modelo'],['3','Comportamento'],['4','Revisão']].map(([n,label])=><button type="button" key={n} onClick={()=>setStep(Number(n))} style={{minWidth:0,padding:'10px 6px',borderRadius:10,border:`1px solid ${step===Number(n)?'var(--adm-accent)':'var(--adm-border)'}`,background:step===Number(n)?'var(--adm-surface2)':'var(--adm-bg)',color:step===Number(n)?'var(--adm-text)':'var(--adm-muted)',fontWeight:800}}><span style={{opacity:.7,marginRight:6}}>{n}</span>{label}</button>)}</div>
  {step===1&&<div><h3 style={{margin:'0 0 5px'}}>Conecte o {name}</h3><p style={{fontSize:13,color:'var(--adm-muted)',lineHeight:1.55}}>Cole a chave criada no {gemini?'Google AI Studio':'OpenRouter'}. O valor é armazenado criptografado e você pode usar Mostrar/Ocultar antes de salvar.</p><SecretField label="Chave / token da API" value={form.secret} onChange={v=>setForm(f=>({...f,secret:v}))} placeholder={current?.configured?'Digite somente para substituir':gemini?'Cole sua Gemini API Key':'sk-or-...'}/><div className="ai-note">{current?.configured?'Já existe uma credencial salva. Deixe o campo vazio se quiser manter a atual.':'Depois de colar a chave, você pode carregar a lista real de modelos na próxima etapa.'}</div></div>}
  {step===2&&<div><h3 style={{margin:'0 0 5px'}}>Modelo</h3><div className="ai-api-readonly"><b>URL da API</b><code>{defaultUrl}</code><span>Endereço oficial usado pelo AL Sistemas. Não é sua chave e não precisa ser alterado.</span></div><div className="model-picker-head"><b>Modelo padrão</b><button type="button" onClick={loadModels} disabled={modelsBusy}>{modelsBusy?'Carregando…':'↻ Carregar modelos'}</button></div><Field label="Nome do modelo" list={`models-${provider}`} value={form.metadata.model} onChange={v=>setMeta('model',v)} placeholder={gemini?'gemini-2.5-flash':'openrouter/free'}/><datalist id={`models-${provider}`}>{models.map(m=><option key={m.id} value={m.id}>{m.free?'GRÁTIS • ':''}{m.name}</option>)}</datalist>{models.length>0&&<><div className="ai-note">Lista carregada diretamente de {name}. Você ainda pode digitar manualmente um modelo que não apareça aqui.</div><div className="ai-model-cap-list">{models.slice(0,8).map(m=><button type="button" key={m.id} className={m.id===form.metadata.model?'selected':''} onClick={()=>setMeta('model',m.id)}><b>{m.name}</b><span>{m.free===true?'Grátis':m.free===false?'Pago/misto':'Preço não informado'}{m.contextLength?` · contexto ${Math.round(m.contextLength/1000)}k`:''}{m.supportsStructured===true?' · JSON ✓':m.supportsStructured===false?' · JSON não informado/suportado':''}</span></button>)}</div>{selectedModel&&<div className="ai-model-selected"><b>Capacidade do modelo selecionado</b><span>{selectedModel.contextLength?`Contexto informado: ${selectedModel.contextLength.toLocaleString('pt-BR')} tokens. `:''}{selectedModel.supportsStructured===true?'Saída estruturada declarada pelo provedor.':selectedModel.supportsStructured===false?'O provedor não declarou suporte a saída estruturada; o AL tentará o modo compatível e validará o JSON localmente.':'Capacidade de saída estruturada não informada pelo provedor; o AL fará detecção e fallback.'}</span></div>}</>}<div className="ai-params-grid"><Field label="Limite de tokens" type="number" min="32" max="32768" value={form.metadata.maxTokens} onChange={v=>setMeta('maxTokens',Number(v))}/><Field label="Temperatura" type="number" min="0" max="2" step="0.05" value={form.metadata.temperature} onChange={v=>setMeta('temperature',Number(v))}/></div><div className="ai-note">O botão <b>Testar</b> agora faz uma geração mínima com este modelo. Assim ele valida chave + modelo, não apenas a existência da credencial.</div></div>}
  {step===3&&<div><h3 style={{margin:'0 0 5px'}}>Como a IA deve trabalhar</h3><p style={{fontSize:13,color:'var(--adm-muted)',lineHeight:1.55}}>O núcleo usa perfis automáticos por tarefa: Assistente, Editorial, SEO, Diagnóstico, RSS, Tradução e Rápido. Cada perfil possui temperatura, limite de contexto e prioridade próprios.</p><label className="ai-toggle-row"><input type="checkbox" checked={active} onChange={e=>setMeta('enabled',e.target.checked)}/><span><b>Ativar este provedor</b><small>Desative temporariamente sem apagar a chave ou as configurações.</small></span></label><label className={`ai-toggle-row ${!active?'disabled':''}`}><input type="checkbox" checked={!!form.metadata.primary} disabled={!active} onChange={e=>setMeta('primary',e.target.checked)}/><span><b>Usar como IA principal</b><small>Se falhar, o motor respeita Retry-After, aplica cooldown e tenta o provedor alternativo sem repetir chamadas inúteis.</small></span></label><label style={{display:'block',fontSize:13,fontWeight:700}}>Instruções personalizadas<textarea value={form.metadata.systemInstructions||''} onChange={e=>setMeta('systemInstructions',e.target.value)} rows={5} maxLength={8000} style={{marginTop:7,width:'100%',boxSizing:'border-box',padding:12,borderRadius:10,border:'1px solid var(--adm-border)',background:'var(--adm-bg)',color:'var(--adm-text)',resize:'vertical'}}/><span style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11,fontWeight:400,color:'var(--adm-muted)',marginTop:5}}><span>Aplicadas apenas aos perfis editorial/SEO/Assistente. Diagnóstico e tradução ficam isolados destas instruções.</span><span>{(form.metadata.systemInstructions||'').length}/8000</span></span></label><div className="ai-privacy"><b>Privacidade — dados que podem ser enviados à IA</b>{[['editorial','Conteúdo editorial'],['rssContent','Conteúdo RSS'],['readme','README de repositórios'],['githubLogs','Logs GitHub'],['vercelLogs','Logs Vercel'],['renderLogs','Logs Render'],['mongoDocuments','Documentos MongoDB detalhados']].map(([k,label])=><label key={k}><input type="checkbox" checked={k==='mongoDocuments'?form.metadata.privacy?.[k]===true:form.metadata.privacy?.[k]!==false} onChange={e=>setMeta('privacy',{...(form.metadata.privacy||{}),[k]:e.target.checked})}/><span>{label}</span></label>)}</div></div>}
  {step===4&&<div><h3 style={{margin:'0 0 12px'}}>Revisão da configuração</h3><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:9}}><StatusBox label="Provedor" value={name}/><StatusBox label="Estado" value={active?'Ativo':'Pausado'}/><StatusBox label="Modelo" value={form.metadata.model||(gemini?'gemini-2.5-flash':'openrouter/free')}/><StatusBox label="Ordem" value={active?(form.metadata.primary?'Principal':'Fallback'):'Fora da rotação'}/></div><div className="ai-review-callout"><b>Teste recomendado antes de salvar em produção</b><span>O teste faz uma pequena geração real. Em uso normal, se a IA principal falhar, a outra integração ativa é usada automaticamente.</span></div></div>}
  <div style={{display:'flex',justifyContent:'space-between',gap:8,marginTop:18}}><button type="button" disabled={step===1} onClick={()=>setStep(s=>Math.max(1,s-1))}>← Voltar</button><button type="button" disabled={step===4} onClick={()=>setStep(s=>Math.min(4,s+1))}>Continuar →</button></div>
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

function PortalApiConnector({provider,current,form,setForm}){
 const setMeta=(key,value)=>setForm(f=>({...f,metadata:{...f.metadata,[key]:value}}))
 const football=provider==='api_football'
 return <div>
  <div style={{padding:12,borderRadius:10,border:'1px solid var(--adm-border)',background:'var(--adm-surface2)',marginBottom:14,fontSize:12,lineHeight:1.55}}>
   <b>{football?'Futebol na Home':'Horóscopo na Home'}</b>
   <div style={{color:'var(--adm-muted)',marginTop:5}}>{football?'A chave nunca vai para o navegador. Live scores usam cache curto; jogos do dia usam cache maior para economizar cota.':'A chave nunca vai para o navegador. Cada signo é consultado sob demanda e fica em cache por várias horas.'}</div>
  </div>
  <SecretField label={current?.configured?'Nova API Key (deixe vazio para manter)':'API Key'} value={form.secret} onChange={v=>setForm({...form,secret:v})} placeholder={current?.configured?'Digite somente para substituir':'Cole a chave da API'}/>
  {football?<>
   <Field label="IDs de ligas prioritárias (opcional)" value={form.metadata.leagueIds||''} onChange={v=>setMeta('leagueIds',v)} placeholder="Ex.: 71,72,73"/>
   <Field label="Máximo de jogos no portal" type="number" min="2" max="12" value={form.metadata.maxMatches||6} onChange={v=>setMeta('maxMatches',Number(v)||6)}/>
   <Field label="Atualização durante jogo ao vivo (segundos)" type="number" min="60" max="900" value={form.metadata.liveCacheSeconds||300} onChange={v=>setMeta('liveCacheSeconds',Math.max(60,Math.min(900,Number(v)||300)))}/>
   <div style={{fontSize:11,color:'var(--adm-muted)',marginTop:-6,marginBottom:10}}>Padrão: 300 s (5 min). Quando não há partida ao vivo, o AL reduz automaticamente as consultas para proteger a cota da API.</div>
   <label className="ai-toggle-row"><input type="checkbox" checked={form.metadata.showInternational!==false} onChange={e=>setMeta('showInternational',e.target.checked)}/><span><b>Completar com jogos internacionais</b><small>Sem IDs de liga, o AL prioriza partidas do Brasil e depois completa a lista.</small></span></label>
  </>:<label className="ai-toggle-row"><input type="checkbox" checked={form.metadata.translatePtBr!==false} onChange={e=>setMeta('translatePtBr',e.target.checked)}/><span><b>Traduzir para português com a IA do AL</b><small>Usa Gemini/OpenRouter já configurados; se a IA falhar, mostra o texto original.</small></span></label>}
 </div>
}

function RenderConnector({current,form,setForm}){
 return <div>
  <div style={{padding:12,borderRadius:10,border:'1px solid var(--adm-border)',background:'var(--adm-surface2)',marginBottom:14,fontSize:12,lineHeight:1.55}}>
   <b>Fonte única para o módulo Plataformas</b>
   <div style={{color:'var(--adm-muted)',marginTop:5}}>Serviços e deploys exibidos em <b>Infraestrutura → Plataformas</b> usam esta chave. Não é necessário configurar a Render em outra tela.</div>
  </div>
  <SecretField label={current?.configured?'Nova Render API Key (deixe vazio para manter)':'Render API Key'} value={form.secret} onChange={v=>setForm({...form,secret:v})} placeholder={current?.configured?'Digite somente para substituir':'Cole a API Key da Render'}/>
 </div>
}

function VercelConnector({current,form,setForm}){
 const setMeta=(key,value)=>setForm(f=>({...f,metadata:{...f.metadata,[key]:value}}))
 return <div>
  <div style={{padding:12,borderRadius:10,border:'1px solid var(--adm-border)',background:'var(--adm-surface2)',marginBottom:14,fontSize:12,lineHeight:1.55}}>
   <b>Fonte única para projetos e deploys</b>
   <div style={{color:'var(--adm-muted)',marginTop:5}}>O módulo <b>Infraestrutura → Plataformas</b> usa este token automaticamente. A configuração antiga dentro da própria página de plataformas foi desativada para evitar duas fontes diferentes.</div>
  </div>
  <SecretField label={current?.configured?'Novo Vercel Access Token (deixe vazio para manter)':'Vercel Access Token'} value={form.secret} onChange={v=>setForm({...form,secret:v})} placeholder={current?.configured?'Digite somente para substituir':'Cole o token da Vercel'}/>
  <Field label="Team ID (opcional)" value={form.metadata.teamId||''} onChange={v=>setMeta('teamId',v)} placeholder="team_xxxxxxxxxxxx"/>
  <div style={{fontSize:12,color:'var(--adm-muted)',marginTop:-6}}>Deixe vazio para sua conta pessoal. Informe apenas se quiser direcionar as consultas para uma Team específica.</div>
 </div>
}

function CloudflareConnector({current,form,setForm,diagnostic}){
 const [cloudflareTab,setCloudflareTab]=useState('api')
 const setMeta=(key,value)=>setForm(f=>({...f,metadata:{...f.metadata,[key]:value}}))
 const setSecret=(key,value)=>setForm(f=>({...f,secrets:{...f.secrets,[key]:value}}))
 const account=String(form.metadata.accountId||current?.metadata?.accountId||'').trim()
 const endpoint=account?`https://${account}.r2.cloudflarestorage.com`:'Será calculado após informar o Account ID'
 return <div>
  <div className="cloudflare-config-tabs" role="tablist" aria-label="Configuração Cloudflare">
   <button type="button" role="tab" aria-selected={cloudflareTab==='api'} className={cloudflareTab==='api'?'active':''} onClick={()=>setCloudflareTab('api')}>Cloudflare API</button>
   <button type="button" role="tab" aria-selected={cloudflareTab==='r2'} className={cloudflareTab==='r2'?'active':''} onClick={()=>setCloudflareTab('r2')}>R2 Storage</button>
  </div>

  {cloudflareTab==='api'?<>
   <div style={{padding:13,borderRadius:11,border:'1px solid var(--adm-border)',background:'var(--adm-surface2)',marginBottom:14}}>
    <div style={{fontSize:11,fontWeight:900,letterSpacing:'.08em',color:'var(--adm-accent)'}}>CLOUDFLARE REST API</div>
    <div style={{fontSize:12,color:'var(--adm-muted)',lineHeight:1.55,marginTop:5}}>Administra produtos da conta: zonas/DNS, Workers, Pages, KV, D1, Queues, Vectorize, AI Gateway e R2 conforme as permissões reais do token.</div>
   </div>
   <SecretField label={current?.configured?'Novo API Token (deixe vazio para manter)':'Cloudflare API Token'} value={form.secret} onChange={v=>setForm({...form,secret:v})} placeholder={current?.configured?'cfat_••••••••••••':'cfat_...'}/>
   <Field label="Account ID" value={form.metadata.accountId||''} onChange={v=>setMeta('accountId',v.trim())} placeholder="32 caracteres"/>
   <div className="cloudflare-tab-note"><b>R2 separado</b><span>As credenciais S3 ficam na aba <b>R2 Storage</b>. O API Token e o Account ID atuais continuam sendo usados normalmente.</span></div>
  </>:<>
   <div style={{padding:13,borderRadius:11,border:'1px solid var(--adm-border)',background:'var(--adm-surface2)',marginBottom:12}}>
    <div style={{fontSize:11,fontWeight:900,letterSpacing:'.08em',color:'var(--adm-accent)'}}>R2 · S3 COMPATÍVEL</div>
    <div style={{fontSize:12,color:'var(--adm-muted)',lineHeight:1.55,marginTop:5}}>Use as credenciais criadas em <b>R2 → Manage R2 API Tokens</b> com permissão de leitura e escrita. Elas são diferentes do API Token da aba anterior.</div>
   </div>
   <SecretField label={current?.configured?'Novo R2 Access Key ID (deixe vazio para manter)':'R2 Access Key ID'} value={form.secrets?.r2AccessKeyId||''} onChange={v=>setSecret('r2AccessKeyId',v)} placeholder={current?.configured?'••••••••••••':'Access Key ID'}/>
   <SecretField label={current?.configured?'Novo R2 Secret Access Key (deixe vazio para manter)':'R2 Secret Access Key'} value={form.secrets?.r2SecretAccessKey||''} onChange={v=>setSecret('r2SecretAccessKey',v)} placeholder={current?.configured?'••••••••••••':'Secret Access Key'}/>
   <div style={{padding:11,border:'1px solid var(--adm-border)',borderRadius:9,background:'var(--adm-bg)',margin:'3px 0 17px'}}>
    <div style={{fontSize:10,fontWeight:800,color:'var(--adm-muted)'}}>ENDPOINT R2 GERADO AUTOMATICAMENTE</div>
    <code style={{display:'block',fontSize:10,marginTop:5,color:'var(--adm-text)',overflowWrap:'anywhere'}}>{endpoint}</code>
   </div>
   <h4 style={{margin:'18px 0 8px'}}>Preferências R2</h4>
   <p style={{margin:'0 0 12px',fontSize:12,color:'var(--adm-muted)',lineHeight:1.5}}>O bucket não precisa mais ser digitado aqui. Depois de conectar, abra <b>Cloudflare → R2 Storage</b> e escolha um bucket existente com <b>Usar no AL</b>.</p>
   <Field label="Bucket padrão (opcional / compatibilidade)" value={form.metadata.r2Bucket||''} onChange={v=>setMeta('r2Bucket',v)} placeholder={current?.metadata?.r2Bucket||'pode deixar vazio'}/>
   <Field label="URL pública do bucket (opcional)" value={form.metadata.r2PublicUrl||''} onChange={v=>setMeta('r2PublicUrl',v)} placeholder="https://arquivos.seudominio.com"/>
  </>}

  {diagnostic&&<div style={{marginTop:14,padding:12,borderRadius:10,border:`1px solid ${diagnostic.ok===false?'#ef444455':'#16a34a55'}`,background:diagnostic.ok===false?'#ef44440b':'#16a34a0b'}}>
   <b style={{fontSize:12}}>{diagnostic.ok===false?'⚠ Teste não concluído':'✓ Diagnóstico da conexão'}</b>
   {diagnostic.erro&&<div style={{fontSize:11,color:'#ef4444',marginTop:5}}>{diagnostic.erro}</div>}
   {diagnostic.account&&<div style={{fontSize:11,color:'var(--adm-muted)',marginTop:5}}>Conta REST: <b>{diagnostic.account.name||diagnostic.account.id}</b></div>}
   {diagnostic.endpointS3&&<div style={{fontSize:10,color:'var(--adm-muted)',marginTop:4,overflowWrap:'anywhere'}}>S3: <code>{diagnostic.endpointS3}</code></div>}
   {diagnostic.s3?.configured&&<div style={{fontSize:11,color:diagnostic.s3.ok?'#16a34a':'#d97706',marginTop:5}}>{diagnostic.s3.ok?`R2 S3 válido · ${diagnostic.s3.buckets?.length||0} bucket(s) acessível(is)`:`R2 S3 não validado: ${diagnostic.s3.error||'revise as credenciais'}`}</div>}
  </div>}
  {current?.configured&&<a href="/admin/cloudflare" style={{display:'inline-block',marginTop:13,fontSize:12,fontWeight:800,color:'var(--adm-accent)'}}>Abrir Central Cloudflare →</a>}
 </div>
}

function GitHubConnector({current,form,setForm,github,setGithub,busy,onConnect,onReload,onSavePreferences}){
 const d=github.diagnostics
 const selected=github.preferences?.repository||''
 return <div>
  <div style={{padding:14,borderRadius:10,border:'1px solid var(--adm-border)',background:'var(--adm-surface2)',marginBottom:16,fontSize:13,lineHeight:1.55}}>
   <strong>Token recomendado para o AL Sistemas</strong>
   <div style={{marginTop:6,color:'var(--adm-muted)'}}>Como este painel publica arquivos, administra repositórios e pode editar o perfil conectado, use um <b>Personal Access Token (classic)</b> dedicado ao AL Sistemas.</div>
   <div style={{marginTop:8}}><b>Para publicar e editar detalhes dos repositórios:</b> marque <b>repo</b> (privados e públicos) ou <b>public_repo</b> se trabalhar exclusivamente com repositórios públicos.</div>
   <div style={{marginTop:5}}><b>Para editar o perfil pelo AL:</b> marque <b>user</b>. Em token fine-grained, use <b>Profile: write</b> para o perfil e <b>Administration: write</b> nos repositórios que poderão ter descrição/homepage alteradas.</div>
   <div style={{marginTop:5}}><b>Somente se quiser permitir apagar repositórios pelo painel:</b> marque também <b>delete_repo</b>. Essa permissão é poderosa e não é necessária para atualizar o site.</div>
   <div style={{marginTop:5}}><b>Workflows:</b> marque <b>workflow</b> apenas se o AL Sistemas precisar criar ou alterar arquivos em <code>.github/workflows/</code>.</div>
   <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer" style={{display:'inline-block',marginTop:10,color:'var(--adm-accent)',fontWeight:700}}>Criar Personal Access Token (classic) ↗</a>
   <div style={{marginTop:7}}><a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" style={{color:'var(--adm-accent)'}}>Gerenciar tokens classic ↗</a></div>
  </div>

  <SecretField label={current?.configured?'Novo token (somente se quiser trocar)':'Personal Access Token'} value={form.secret} onChange={v=>setForm({...form,secret:v})} placeholder={current?.configured?'ghp_••••••••••••':'ghp_...'}/>
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

   {github.repositories.length>0&&<div style={{marginTop:16}}>
    <div style={{fontWeight:700}}>Repositórios acessíveis ({github.repositories.length})</div>
    <div style={{marginTop:8,maxHeight:280,overflow:'auto',borderTop:'1px solid var(--adm-border)'}}>
     {github.repositories.map(r=><div key={r.id} style={{padding:'10px 2px',borderBottom:'1px solid var(--adm-border)',display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
      <span><b>{r.fullName}</b> {r.private?'🔒':''}</span>
      <span style={{fontSize:12,color:r.permissions?.write?'var(--adm-accent)':'var(--adm-muted)'}}>{r.permissions?.write?'conta pode escrever':'somente leitura'}</span>
     </div>)}
    </div>
   </div>}
  </div>}
 </div>
}
function Diag({ok,text}){return <div style={{fontSize:12,padding:'7px 9px',borderRadius:8,background:'var(--adm-bg)',border:'1px solid var(--adm-border)'}}>{ok?'✅':'⚠️'} {text}</div>}

function SecretField({label,onChange,...props}){const [show,setShow]=useState(false);return <label style={{display:'block',marginBottom:13,fontSize:13,fontWeight:600}}>{label}<div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:8,marginTop:6}}><input {...props} type={show?'text':'password'} onChange={e=>onChange(e.target.value)} style={{marginTop:0,minWidth:0}} autoComplete="new-password"/><button type="button" onClick={()=>setShow(v=>!v)}>{show?'Ocultar':'Mostrar'}</button></div></label>}
function Field({label,onChange,...props}){return <label style={{display:'block',marginBottom:13,fontSize:13,fontWeight:600}}>{label}<input {...props} onChange={e=>onChange(e.target.value)} style={{marginTop:6}} autoComplete="new-password"/></label>}
const card={background:'var(--adm-surface)',border:'1px solid var(--adm-border)',borderRadius:14,padding:18}; const navBtn={width:'100%',display:'flex',border:0,padding:'11px 10px',background:'transparent',textAlign:'left'}
