import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { setupService } from '../../../services/api'
import { SETUP, Ico, Spin, Campo, CampoAcessoFixo, RegrasSenha, SeletorDados, OPCOES_SEED, inputSty, labelSty } from './SetupForms'
import { RADIUS } from '../../../themes/tokens'

const ETAPAS = [
  ['Banco de dados','Escolha Atlas, MongoDB na VPS ou uma conexão avançada'],
  ['Organização','Identifique quem administra o sistema'], ['Site','Defina o nome público do portal'],
  ['Administrador','Crie o primeiro usuário'], ['Dados iniciais','Escolha importar exemplos ou começar vazio'], ['Revisão','Confira tudo antes de instalar'],
]
const shell={minHeight:'100vh',background:`radial-gradient(circle at 12% 0%,rgba(22,163,106,.10),transparent 30%),radial-gradient(circle at 90% 10%,rgba(37,99,235,.06),transparent 24%),linear-gradient(180deg,${SETUP.bgSoft} 0%,${SETUP.bg} 100%)`,padding:'32px 16px',color:SETUP.text,fontFamily:"'Geist','Segoe UI',system-ui,sans-serif"}
function StepDots({atual}){return <div style={{display:'grid',gridTemplateColumns:`repeat(${ETAPAS.length},1fr)`,gap:8,margin:'22px 0 26px'}}>{ETAPAS.map(([nome],i)=><div key={nome}><div style={{height:5,borderRadius:10,background:i<=atual?SETUP.accent:SETUP.border}}/><div style={{marginTop:7,fontSize:10,color:i===atual?SETUP.text:SETUP.muted,fontWeight:i===atual?800:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{i+1}. {nome}</div></div>)}</div>}
function btn(primary,disabled=false){return{flex:primary?1:'0 0 110px',minHeight:46,borderRadius:RADIUS.lg,border:primary?'none':`1px solid ${SETUP.border}`,background:disabled?SETUP.surface2:primary?SETUP.accent:SETUP.surface2,color:disabled?SETUP.muted:primary?'#ffffff':SETUP.text,fontWeight:800,cursor:disabled?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}
function Nav({etapa,onVoltar,onAvancar,avancarLabel='Avançar',disabled=false,loading=false}){return <div style={{display:'flex',gap:10,marginTop:24}}>{etapa>0&&<button type="button" onClick={onVoltar} disabled={loading} style={btn(false)}>Voltar</button>}<button type="button" onClick={onAvancar} disabled={disabled||loading} style={btn(true,disabled||loading)}>{loading?<><Spin/> Processando…</>:<>{avancarLabel} <span>→</span></>}</button></div>}
function Notice({type='info',children}){const cor=type==='ok'?SETUP.success:type==='error'?SETUP.danger:SETUP.blue;const bg=type==='ok'?SETUP.successSoft:type==='error'?SETUP.dangerSoft:SETUP.blueSoft;return <div style={{padding:'12px 14px',borderRadius:RADIUS.lg,border:`1px solid ${cor}33`,background:bg,color:type==='error'?SETUP.danger:SETUP.subtle,fontSize:12,lineHeight:1.55}}>{children}</div>}
function ModeButton({active,title,desc,onClick}){return <button type="button" onClick={onClick} style={{textAlign:'left',padding:14,borderRadius:RADIUS.lg,border:`1.5px solid ${active?SETUP.accent:SETUP.border}`,background:active?SETUP.accentSoft:SETUP.surface,color:SETUP.text,cursor:'pointer'}}><div style={{fontWeight:800,marginBottom:4}}>{active?'✓ ':''}{title}</div><div style={{fontSize:11,color:SETUP.muted,lineHeight:1.45}}>{desc}</div></button>}
function TextInput({label,value,onChange,placeholder,type='text'}){return <div style={{marginTop:14}}><label style={labelSty}>{label}</label><input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} autoCapitalize="none" spellCheck="false" style={{...inputSty(false),color:SETUP.text,caretColor:SETUP.accent}}/></div>}

function SetupPerformanceSummary(){
 const boot=typeof window!=='undefined'?window.__AL_SETUP_BOOT__:null
 const timings=typeof window!=='undefined'?(window.__AL_SETUP_TIMINGS__||{}):{}
 if(!boot)return null
 const httpMs=Number(boot.elapsed||0),serverMs=Number(boot.status?.diagnostico_boot?.servidor_ms||0),chunkMs=Number(timings.setupChunkMs||0)
 const slow=httpMs>700||chunkMs>700
 const fmt=v=>v?`${v<1000?Math.round(v): (v/1000).toFixed(1)+' s'}`.replace(/^(\d+)$/, '$1 ms'):'—'
 async function copiar(){
  const txt=[
   'AL Sistemas — diagnóstico do setup',
   `HTTP /api/setup/status: ${httpMs.toFixed(1)} ms`,
   `Processamento no backend: ${serverMs.toFixed(1)} ms`,
   `Carregamento do módulo setup: ${chunkMs?chunkMs.toFixed(1)+' ms':'não medido/cache'}`,
   `Estado: ${boot.status?.estado||'desconhecido'}`,
   `Backend uptime: ${boot.status?.diagnostico_boot?.processo_uptime_s??'—'} s`,
   `URL: ${location.href}`,
   `Navegador: ${navigator.userAgent}`,
  ].join('\n')
  try{await navigator.clipboard.writeText(txt);toast.success('Diagnóstico copiado.')}catch{toast.error('Não foi possível copiar automaticamente.')}
 }
 return <div style={{margin:'0 0 18px',padding:'12px 14px',borderRadius:RADIUS.lg,border:`1px solid ${slow?SETUP.warning+'55':SETUP.success+'33'}`,background:slow?`${SETUP.warning}0d`:SETUP.successSoft}}>
  <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}>
   <div><div style={{fontSize:12,fontWeight:900,color:SETUP.text}}>Diagnóstico da inicialização</div><div style={{fontSize:10.5,color:SETUP.muted,marginTop:3}}>HTTP <strong>{fmt(httpMs)}</strong> • backend <strong>{fmt(serverMs)}</strong>{chunkMs?<> • módulo <strong>{fmt(chunkMs)}</strong></>:null}</div></div>
   <button type="button" onClick={copiar} style={{border:`1px solid ${SETUP.border}`,background:SETUP.surface,color:SETUP.text,borderRadius:8,padding:'7px 10px',fontSize:11,fontWeight:800,cursor:'pointer'}}>Copiar diagnóstico</button>
  </div>
  {httpMs>700&&serverMs<100&&<div style={{fontSize:10.5,color:SETUP.warning,marginTop:8,lineHeight:1.45}}>A rota respondeu rápido no servidor, mas a ida/volta HTTP demorou. O gargalo tende a estar no Vite, navegador ou comunicação local.</div>}
  {serverMs>700&&<div style={{fontSize:10.5,color:SETUP.warning,marginTop:8,lineHeight:1.45}}>O próprio backend demorou para calcular o estado do setup. Vamos investigar leitura do cofre/armazenamento local.</div>}
  {chunkMs>700&&<div style={{fontSize:10.5,color:SETUP.warning,marginTop:8,lineHeight:1.45}}>O módulo do assistente demorou para ser processado pelo Vite. Este é um forte candidato à lentidão no Termux.</div>}
 </div>
}

function parseEnvCredentials(text){
 const vars={}
 for(const raw of String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/)){
  const line=raw.trim();if(!line||line.startsWith('#'))continue
  const clean=line.startsWith('export ')?line.slice(7).trim():line
  const idx=clean.indexOf('=');if(idx<=0)continue
  const key=clean.slice(0,idx).trim();let value=clean.slice(idx+1).trim()
  if((value.startsWith('\"')&&value.endsWith('\"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1)
  vars[key]=value
 }
 const uri=vars.MONGODB_URI||vars.MONGO_URI||''
 let username=vars.MONGODB_USERNAME||vars.MONGO_USERNAME||''
 let password=vars.MONGODB_PASSWORD||vars.MONGO_PASSWORD||''
 let host=''
 if(uri){
  if(!/^mongodb(?:\+srv)?:\/\//i.test(uri)) throw new Error('MONGODB_URI não é uma URI MongoDB válida.')
  try{
   const parsed=new URL(uri)
   host=parsed.hostname||''
   if(!username&&parsed.username)username=decodeURIComponent(parsed.username)
   if(!password&&parsed.password)password=decodeURIComponent(parsed.password)
  }catch{
   host=uri.replace(/^mongodb(?:\+srv)?:\/\//i,'').replace(/^[^@]+@/,'').split(/[/?#]/)[0].replace(/:\d+$/,'')
  }
 }
 const databaseName=vars.MONGODB_DATABASE||vars.MONGODB_DB_NAME||vars.MONGO_DB_NAME||''
 if(!host) throw new Error('Não encontrei o cluster em MONGODB_URI.')
 if(!username) throw new Error('Não encontrei MONGODB_USERNAME no arquivo.')
 if(!password) throw new Error('Não encontrei MONGODB_PASSWORD no arquivo.')
 return {host,username,password,databaseName}
}
function parsePortableBackup(text,filename=''){
 const raw=String(text||'').replace(/^\uFEFF/,'').trim()
 let vars={}
 if(filename.toLowerCase().endsWith('.json')||raw.startsWith('{')){
  const parsed=JSON.parse(raw)
  if(parsed?.product && parsed.product!=='AL Sistemas') throw new Error('Este JSON não é um backup do AL Sistemas.')
  vars=parsed?.variables&&typeof parsed.variables==='object'?parsed.variables:parsed
 }else{
  for(const lineRaw of raw.split(/\r?\n/)){
   const line=lineRaw.trim(); if(!line||line.startsWith('#'))continue
   const clean=line.startsWith('export ')?line.slice(7).trim():line
   const idx=clean.indexOf('='); if(idx<=0)continue
   const key=clean.slice(0,idx).trim(); let value=clean.slice(idx+1).trim()
   if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1)
   vars[key]=value.replace(/\n/g,'\n')
  }
 }
 if(!vars||typeof vars!=='object'||Array.isArray(vars)) throw new Error('Backup sem variáveis reconhecíveis.')
 const known=['MONGO_URI','GITHUB_TOKEN','GEMINI_API_KEY','OPENROUTER_API_KEY','CLOUDINARY_API_SECRET','CF_API_TOKEN','VERCEL_TOKEN']
 if(!known.some(k=>vars[k])) throw new Error('Não encontrei configurações compatíveis do AL Sistemas neste arquivo.')
 const masked=v=>!v||/^\*{6,}$/.test(String(v))||/^•{6,}$/.test(String(v))
 const services=[]
 if(vars.MONGO_URI)services.push('MongoDB')
 if(vars.GITHUB_TOKEN)services.push('GitHub')
 if(vars.GEMINI_API_KEY)services.push('Gemini')
 if(vars.OPENROUTER_API_KEY)services.push('OpenRouter')
 if(vars.CLOUDINARY_API_SECRET)services.push('Cloudinary')
 if(vars.CF_API_TOKEN)services.push('Cloudflare/R2')
 if(vars.VERCEL_TOKEN)services.push('Vercel')
 return {vars,services,secretsAvailable:known.some(k=>vars[k]&&!masked(vars[k]))}
}

export default function SetupWizard({statusBanco,onSucesso}){
 const [etapa,setEtapa]=useState(0),[provider,setProvider]=useState('atlas'),[dbName,setDbName]=useState(statusBanco?.banco_nome&&statusBanco.banco_nome!=='não conectado'?statusBanco.banco_nome:'alsistemas')
 const [mongoCfg,setMongoCfg]=useState({host:'',port:'27017',username:'',password:'',authSource:'admin',tls:false,uri:''})
 const [mongo,setMongo]=useState(statusBanco?.mongo_conectado?{ok:true,banco:statusBanco?.banco_nome}:null),[mongoLoading,setMongoLoading]=useState(false),[atlasImport,setAtlasImport]=useState(null),[acaoExistente,setAcaoExistente]=useState(''),[migration,setMigration]=useState(null)
 const [form,setForm]=useState({organizacao:'',nomeSite:'AL Sistemas',nome:'',email:'',senha:'',confirmar:''}),[seed,setSeed]=useState(true),[dadosSel,setDadosSel]=useState(OPCOES_SEED.map(o=>o.id)),[instalando,setInstalando]=useState(false),[erros,setErros]=useState({})
 const resumoSeed=useMemo(()=>seed?`${dadosSel.length} grupos selecionados`:'Começar sem dados de exemplo',[seed,dadosSel]); const set=k=>v=>{setForm(f=>({...f,[k]:v}));setErros(e=>({...e,[k]:''}))}; const mc=k=>v=>{setMongoCfg(c=>({...c,[k]:v}));setMongo(null)}
 async function importarAtlasEnv(file){
  if(!file)return
  setMongo(null);setAtlasImport(null)
  try{
   if(file.size>64*1024)throw new Error('O arquivo é maior que 64 KB e não parece ser um arquivo de credenciais.')
   const parsed=parseEnvCredentials(await file.text())
   setProvider('atlas')
   setMongoCfg(c=>({...c,host:parsed.host,username:parsed.username,password:parsed.password,uri:''}))
   if(parsed.databaseName)setDbName(parsed.databaseName.replace(/[^A-Za-z0-9_-]/g,''))
   setAtlasImport({ok:true,nome:file.name})
   toast.success('Credenciais do Atlas preenchidas. Agora teste a conexão.')
  }catch(err){
   setAtlasImport({ok:false,erro:err.message||'Não foi possível ler o arquivo.'})
   toast.error(err.message||'Arquivo de credenciais inválido.')
  }
 }
 async function importarMigracao(file){
  if(!file)return
  try{
   if(file.size>512*1024)throw new Error('O backup é maior que 512 KB. Use o arquivo exportado por Integrações e APIs.')
   const parsed=parsePortableBackup(await file.text(),file.name)
   setMigration({name:file.name,...parsed})
   const uri=String(parsed.vars.MONGO_URI||'').trim()
   if(uri && !/^\*{6,}$/.test(uri) && !/^•{6,}$/.test(uri)){
    setProvider('custom'); setMongoCfg(c=>({...c,uri})); setMongo(null)
    if(parsed.vars.MONGO_DB_NAME)setDbName(String(parsed.vars.MONGO_DB_NAME).replace(/[^A-Za-z0-9_-]/g,'')||'alsistemas')
   }
   toast.success('Backup reconhecido. Confira o MongoDB e continue a instalação.')
  }catch(err){setMigration(null);toast.error(err.message||'Não foi possível ler o backup.')}
 }
 function mongoPayload(){return {mongo_provider:provider,mongo_db_name:dbName.trim()||'alsistemas',mongo_host:mongoCfg.host.trim(),mongo_port:provider==='atlas'?'':mongoCfg.port,mongo_username:mongoCfg.username,mongo_password:mongoCfg.password,mongo_auth_source:provider==='atlas'?'':(mongoCfg.authSource.trim()||'admin'),mongo_tls:provider==='atlas'?false:mongoCfg.tls,mongo_uri:provider==='custom'?mongoCfg.uri.trim():''}}
 function mongoCompleto(){if(!dbName.trim())return false;if(provider==='custom')return /^mongodb(?:\+srv)?:\/\//i.test(mongoCfg.uri.trim());return Boolean(mongoCfg.host.trim()&&mongoCfg.username.trim()&&mongoCfg.password)}
 async function conectarESalvar(){if(!mongoCompleto())return toast.error('Preencha os dados obrigatórios da conexão.');setMongoLoading(true);setMongo(null);setAcaoExistente('');try{const payload=mongoPayload();const teste=await setupService.testarMongo(payload);if(!teste.ok){setMongo(teste);return}if(teste.instalacao_existente){setMongo({...teste,ok:true,pendente:true});toast('Este banco já possui uma instalação do AL Sistemas. Escolha como continuar.');return}const salvo=await setupService.salvarEnvConfig(payload);setMongo({ok:true,banco:salvo.banco_nome,provider:salvo.mongo_provider,mensagem:`Conexão validada • banco ${salvo.banco_nome}`});toast.success('MongoDB conectado e salvo.')}catch(err){setMongo({ok:false,erro:err.message||'Não foi possível conectar.'})}finally{setMongoLoading(false)}}
 async function adotarExistente(){setAcaoExistente('adotar');try{const res=await setupService.adotarInstalacao({...mongoPayload(),migration_variables:migration?.vars||undefined});toast.success(res.mensagem||'Instalação existente vinculada.');window.location.href='/admin'}catch(err){toast.error(err.message||'Não foi possível reutilizar a instalação.')}finally{setAcaoExistente('')}}
 async function limparConfigLocal(){setAcaoExistente('limpar');try{const res=await setupService.limparConfigLocal();toast.success(res.mensagem||'Configuração local removida.');setMongo(null);setAtlasImport(null);setTimeout(()=>window.location.reload(),500)}catch(err){toast.error(err.message||'Não foi possível limpar a configuração local.')}finally{setAcaoExistente('')}}
 function validarOrganizacao(){if(!form.organizacao.trim()){setErros({organizacao:'Informe o nome da organização'});return false}return true} function validarSite(){if(!form.nomeSite.trim()){setErros({nomeSite:'Informe o nome do site'});return false}return true}
 function validarAdmin(){const e={};if(!form.nome.trim())e.nome='Informe seu nome';if(!/^\S+@\S+\.\S+$/.test(form.email))e.email='Informe um email válido';if(form.senha.length<8)e.senha='Use pelo menos 8 caracteres';else if(!/[A-Z]/.test(form.senha))e.senha='Inclua pelo menos uma letra maiúscula';else if(!/[0-9]/.test(form.senha))e.senha='Inclua pelo menos um número';else if(!/[^A-Za-z0-9]/.test(form.senha))e.senha='Inclua pelo menos um caractere especial';if(form.senha!==form.confirmar)e.confirmar='As senhas não coincidem';setErros(e);return Object.keys(e).length===0}
 function avancar(){if(etapa===0&&(!mongo?.ok||mongo?.pendente))return toast.error(mongo?.pendente?'Escolha como continuar com a instalação existente.':'Conecte o MongoDB antes de continuar.');if(etapa===1&&!validarOrganizacao())return;if(etapa===2&&!validarSite())return;if(etapa===3&&!validarAdmin())return;setEtapa(e=>Math.min(5,e+1))}
 async function instalar(){setInstalando(true);try{const res=await setupService.instalar({nome:form.nome,email:form.email,senha:form.senha,nome_site:form.nomeSite,organizacao:form.organizacao,importar_seed:seed,dados_escolhidos:seed?dadosSel:[],migration_variables:migration?.vars||undefined});if(res?.migracao?.imported?.length)toast.success(`Integrações restauradas: ${res.migracao.imported.join(', ')}`);onSucesso(res)}catch(err){toast.error(err.message||'Erro na instalação')}finally{setInstalando(false)}}
 const providerLabel=provider==='atlas'?'MongoDB Atlas':provider==='vps'?'MongoDB na VPS':'URI personalizada'
 return <div style={shell}><div style={{width:'100%',maxWidth:650,margin:'0 auto'}}><div style={{display:'flex',alignItems:'center',gap:12}}><div style={{width:44,height:44,borderRadius:14,display:'grid',placeItems:'center',background:SETUP.accentSoft,color:SETUP.accent,border:`1px solid ${SETUP.accent}22`}}>{Ico.shield}</div><div><div style={{fontSize:11,fontWeight:900,letterSpacing:'.12em',color:SETUP.accent}}>AL SISTEMAS</div><h1 style={{fontSize:20,margin:'2px 0 0'}}>Vamos preparar seu painel</h1></div></div><StepDots atual={etapa}/>
 <section style={{background:SETUP.surface,border:`1px solid ${SETUP.border}`,borderRadius:22,padding:'clamp(18px,4vw,30px)',boxShadow:'0 18px 50px rgba(15,23,42,.08)'}}><SetupPerformanceSummary/><div style={{fontSize:11,color:SETUP.accent,fontWeight:900,letterSpacing:'.1em'}}>ETAPA {etapa+1} DE {ETAPAS.length}</div><h2 style={{fontSize:20,margin:'6px 0 5px'}}>{ETAPAS[etapa][0]}</h2><p style={{color:SETUP.muted,fontSize:13,margin:'0 0 24px',lineHeight:1.6}}>{ETAPAS[etapa][1]}</p>
 {etapa===0&&<><div style={{marginBottom:18,padding:16,border:`1px solid ${migration?SETUP.success+'55':SETUP.border}`,borderRadius:RADIUS.xl,background:migration?SETUP.successSoft:SETUP.surface2}}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}><div><div style={{fontWeight:900,fontSize:14,color:SETUP.text}}>Migrando de outro aparelho, VPS ou Vercel?</div><div style={{fontSize:11.5,lineHeight:1.55,color:SETUP.muted,marginTop:4}}>Selecione o backup exportado em <strong>Integrações e APIs → Exportar</strong>. Se ele incluir os segredos, Gemini, OpenRouter, GitHub, Cloudflare/R2, Cloudinary e Vercel serão regravados com segurança na nova instalação.</div></div><label style={{display:'inline-flex',alignItems:'center',minHeight:40,padding:'0 14px',borderRadius:RADIUS.md,background:SETUP.surface,border:`1px solid ${SETUP.border}`,fontWeight:800,fontSize:12,cursor:'pointer',color:SETUP.text}}>Importar backup<input type="file" accept=".env,.json,text/plain,application/json" onChange={e=>{const f=e.target.files?.[0];importarMigracao(f);e.target.value=''}} style={{display:'none'}}/></label></div>{migration&&<div style={{marginTop:12,padding:'10px 12px',borderRadius:RADIUS.md,border:`1px solid ${SETUP.success}44`,background:SETUP.surface}}><div style={{fontSize:12,fontWeight:800,color:SETUP.success}}>✓ {migration.name}</div><div style={{fontSize:11,color:SETUP.muted,marginTop:4}}>Encontrado: {migration.services.join(', ')}.</div><div style={{fontSize:11,color:SETUP.muted,marginTop:3}}>{migration.secretsAvailable?'O arquivo contém valores restauráveis. Eles serão recriptografados para este novo ambiente.':'As credenciais parecem mascaradas; configurações sem segredo poderão ser reconhecidas, mas as chaves precisarão ser informadas novamente.'}</div><button type="button" onClick={()=>setMigration(null)} style={{marginTop:8,border:0,background:'transparent',color:SETUP.danger,fontWeight:800,fontSize:11,cursor:'pointer'}}>Remover backup</button></div>}</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10}}><ModeButton active={provider==='atlas'} title="MongoDB Atlas" desc="Cluster gerenciado na nuvem." onClick={()=>{setProvider('atlas');setMongo(null)}}/><ModeButton active={provider==='vps'} title="MongoDB na VPS" desc="Community Edition no seu servidor." onClick={()=>{setProvider('vps');setMongo(null)}}/><ModeButton active={provider==='custom'} title="Avançado" desc="Cole uma URI mongodb:// ou mongodb+srv://." onClick={()=>{setProvider('custom');setMongo(null)}}/></div>
 <div style={{marginTop:16}}><Notice>{provider==='atlas'?'Informe o cluster, usuário e senha do Atlas. O AL Sistemas monta a Connection String e protege a credencial no cofre local.':provider==='vps'?'Use o MongoDB Community instalado na VPS. O padrão recomendado é 127.0.0.1:27017 com autenticação no banco admin.':'Use esta opção para Docker, redes privadas ou uma Connection String personalizada.'}</Notice></div>
 {provider==='atlas'&&<><div style={{marginTop:14,padding:14,border:`1px dashed ${SETUP.accent}66`,borderRadius:RADIUS.lg,background:SETUP.accentSoft}}><div style={{fontWeight:800,fontSize:13,color:SETUP.text}}>Importar credenciais do MongoDB Atlas</div><div style={{fontSize:11,lineHeight:1.55,color:SETUP.muted,margin:'5px 0 11px'}}>Selecione o arquivo <strong>.env</strong> baixado do Atlas. Ele é lido somente neste navegador e não é enviado ao servidor como arquivo.</div><label style={{display:'inline-flex',alignItems:'center',justifyContent:'center',minHeight:40,padding:'0 14px',borderRadius:RADIUS.md,background:SETUP.surface,border:`1px solid ${SETUP.border}`,fontWeight:800,fontSize:12,cursor:'pointer',color:SETUP.text}}>Selecionar arquivo .env<input type="file" accept=".env,text/plain" onChange={e=>{const f=e.target.files?.[0];importarAtlasEnv(f);e.target.value=''}} style={{display:'none'}}/></label>{atlasImport?.ok&&<div style={{marginTop:10,fontSize:11,color:SETUP.success}}>✓ {atlasImport.nome} lido com sucesso. Confira os campos e teste a conexão.</div>}{atlasImport&&!atlasImport.ok&&<div style={{marginTop:10,fontSize:11,color:SETUP.danger}}>{atlasImport.erro}</div>}</div><TextInput label="Cluster Atlas" value={mongoCfg.host} onChange={v=>mc('host')(v.replace(/^mongodb\+srv:\/\//i,'').replace(/^mongodb:\/\//i,'').replace(/^[^@]+@/,'').split(/[/?#]/)[0].replace(/:\d+$/,''))} placeholder="cluster0.xxxxx.mongodb.net"/><TextInput label="Usuário do banco" value={mongoCfg.username} onChange={mc('username')} placeholder="alsistemas_user"/><TextInput label="Senha do banco" type="password" value={mongoCfg.password} onChange={mc('password')} placeholder="Senha do usuário MongoDB"/></>}
 {provider==='vps'&&<><TextInput label="Servidor / Host" value={mongoCfg.host} onChange={mc('host')} placeholder="127.0.0.1"/><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}><TextInput label="Porta" value={mongoCfg.port} onChange={mc('port')} placeholder="27017"/><TextInput label="Banco de autenticação" value={mongoCfg.authSource} onChange={mc('authSource')} placeholder="admin"/></div><TextInput label="Usuário do MongoDB" value={mongoCfg.username} onChange={mc('username')} placeholder="alsistemas_user"/><TextInput label="Senha do MongoDB" type="password" value={mongoCfg.password} onChange={mc('password')} placeholder="Senha do usuário"/><label style={{display:'flex',gap:9,alignItems:'center',marginTop:14,fontSize:12,color:SETUP.subtle}}><input type="checkbox" checked={mongoCfg.tls} onChange={e=>mc('tls')(e.target.checked)}/> Usar TLS nesta conexão</label></>}
 {provider==='custom'&&<TextInput label="URI de conexão" value={mongoCfg.uri} onChange={mc('uri')} placeholder="mongodb://usuario:senha@host:27017/?authSource=admin"/>}
 <TextInput label="Nome do banco do AL Sistemas" value={dbName} onChange={v=>{setDbName(v.replace(/[^A-Za-z0-9_-]/g,''));setMongo(null)}} placeholder="alsistemas"/><div style={{fontSize:11,color:SETUP.muted,marginTop:7}}>Dentro dele serão criadas as coleções do sistema. O padrão é <strong style={{color:SETUP.text}}>alsistemas</strong>.</div>
 {mongo?.ok&&!mongo?.pendente&&<div style={{marginTop:14}}><Notice type="ok">✓ {mongo.mensagem}</Notice></div>}{mongo&&!mongo.ok&&<div style={{marginTop:14}}><Notice type="error">{mongo.erro}</Notice></div>}{mongo?.pendente&&<div style={{marginTop:14,padding:15,border:`1px solid ${SETUP.warning}55`,borderRadius:RADIUS.lg,background:`${SETUP.warning}10`}}><div style={{fontWeight:900,color:SETUP.warning,fontSize:13}}>Instalação existente encontrada</div><div style={{fontSize:12,lineHeight:1.6,color:SETUP.text,marginTop:6}}>{mongo.mensagem} Foram encontrados <strong>{mongo.usuarios}</strong> usuário(s). O setup não criará outro administrador por cima desta instalação.</div><div style={{fontSize:11,lineHeight:1.55,color:SETUP.muted,marginTop:8}}><strong>Substituir configuração local</strong> conecta este servidor à instalação encontrada. <strong>Limpar configuração local</strong> remove somente o cofre de setup deste servidor; MongoDB, uploads, backups, logs e histórico de atualizações não são apagados.</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:9,marginTop:13}}><button onClick={adotarExistente} disabled={!!acaoExistente} style={btn(true,!!acaoExistente)}>{acaoExistente==='adotar'?<><Spin/> Vinculando…</>:'Substituir e usar esta instalação'}</button><button onClick={limparConfigLocal} disabled={!!acaoExistente} style={btn(false,!!acaoExistente)}>{acaoExistente==='limpar'?<><Spin/> Limpando…</>:'Limpar configuração local'}</button></div></div>}<div style={{display:'flex',gap:10,marginTop:20}}><button onClick={conectarESalvar} disabled={mongoLoading||!mongoCompleto()||!!acaoExistente} style={btn(true,mongoLoading||!mongoCompleto()||!!acaoExistente)}>{mongoLoading?<><Spin/> Testando conexão…</>:'Testar e salvar conexão'}</button></div><Nav etapa={etapa} onAvancar={avancar} disabled={!mongo?.ok||mongo?.pendente}/></>}
 {etapa===1&&<><Campo label="Nome da organização" placeholder="Ex.: AL Sistemas" value={form.organizacao} onChange={set('organizacao')} erro={erros.organizacao} autoComplete="organization"/><Notice>A organização identifica a empresa, equipe ou responsável por esta instalação.</Notice><Nav etapa={etapa} onVoltar={()=>setEtapa(0)} onAvancar={avancar}/></>}
 {etapa===2&&<><Campo label="Nome do site" placeholder="Ex.: Portal Minha Cidade" value={form.nomeSite} onChange={set('nomeSite')} erro={erros.nomeSite}/><Notice>Este é o nome que o visitante verá no portal.</Notice><Nav etapa={etapa} onVoltar={()=>setEtapa(1)} onAvancar={avancar}/></>}
 {etapa===3&&<><Campo label="Seu nome" value={form.nome} onChange={set('nome')} erro={erros.nome} placeholder="Nome do administrador"/><Campo label="Email de acesso" type="email" value={form.email} onChange={set('email')} erro={erros.email} placeholder="admin@exemplo.com"/><Campo label="Senha" type="password" value={form.senha} onChange={set('senha')} erro={erros.senha} visivelInicial/><RegrasSenha senha={form.senha}/><div style={{marginTop:14}}><Campo label="Confirmar senha" type="password" value={form.confirmar} onChange={set('confirmar')} erro={erros.confirmar} visivelInicial/></div><CampoAcessoFixo/><Nav etapa={etapa} onVoltar={()=>setEtapa(2)} onAvancar={avancar}/></>}
 {etapa===4&&<><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:12,marginBottom:18}}>{[{v:true,t:'Importar dados de exemplo',d:'Adiciona conteúdo demonstrativo para explorar o painel.'},{v:false,t:'Começar sem exemplos',d:'Cria somente a estrutura, organização, site e administrador.'}].map(o=><ModeButton key={String(o.v)} active={seed===o.v} title={o.t} desc={o.d} onClick={()=>setSeed(o.v)}/>)}</div>{seed&&<div style={{background:SETUP.input,border:`1px solid ${SETUP.border}`,borderRadius:RADIUS.lg,padding:'14px 14px 4px'}}><SeletorDados selecionados={dadosSel} onChange={setDadosSel}/></div>}<Nav etapa={etapa} onVoltar={()=>setEtapa(3)} onAvancar={avancar}/></>}
 {etapa===5&&<><div style={{display:'grid',gap:10}}>{[['Tipo de banco',providerLabel],['Banco de dados',dbName||'alsistemas'],['Organização',form.organizacao],['Nome do site',form.nomeSite],['Administrador',`${form.nome} • ${form.email}`],['Dados iniciais',resumoSeed],['Migração',migration?`${migration.services.length} integração(ões) encontradas`:'Não importar backup']].map(([a,b])=><div key={a} style={{display:'flex',justifyContent:'space-between',gap:18,padding:'13px 14px',background:SETUP.input,border:`1px solid ${SETUP.border}`,borderRadius:RADIUS.md,fontSize:13}}><span style={{color:SETUP.muted}}>{a}</span><strong style={{textAlign:'right',color:SETUP.text}}>{b}</strong></div>)}</div><div style={{marginTop:16}}><Notice>A origem do MongoDB pode ser alterada depois no painel sem mudar os modelos do sistema.</Notice></div><Nav etapa={etapa} onVoltar={()=>setEtapa(4)} onAvancar={instalar} avancarLabel="Instalar AL Sistemas" loading={instalando}/></>}
 </section><p style={{textAlign:'center',color:SETUP.muted,fontSize:11,marginTop:16}}>Migração simples entre celular, VPS e Vercel • MongoDB central • integrações recriptografadas no novo ambiente</p></div></div>
}
