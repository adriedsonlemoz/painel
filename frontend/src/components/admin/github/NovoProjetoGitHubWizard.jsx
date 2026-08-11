import { useEffect, useMemo, useRef, useState } from 'react'
import { githubService } from '../../../services/domains/github.js'
import { projetosService } from '../../../services/domains/projetos.js'
import { useProjetosCommitStream } from '../../../modules/projetos/useProjetosCommitStream.js'
import { DSBtn } from '../ui/DS.jsx'

const fmtBytes=n=>{const v=Number(n||0);if(v<1024)return `${v} B`;if(v<1024**2)return `${(v/1024).toFixed(1)} KB`;return `${(v/1024**2).toFixed(1)} MB`}

function flattenTree(tree,prefix='',out=[]){
  for(const f of tree?.arquivos||[])out.push(f.relPath||`${prefix}${f.nome}`)
  for(const p of tree?.pastas||[])flattenTree(p,`${prefix}${p.nome}/`,out)
  return out
}

function StepDots({step}){
  const labels=['Projeto','Detalhes','Arquivos','Revisão','Commit','Pronto']
  return <div className="gh-create-dots" aria-label={`Etapa ${step} de ${labels.length}`}>
    {labels.map((label,i)=><span key={label} className={`${i+1===step?'active':''} ${i+1<step?'done':''}`} title={label}>{i+1<step?'✓':i+1}</span>)}
  </div>
}

export default function NovoProjetoGitHubWizard({status,onClose,onCreated}){
  const [step,setStep]=useState(1)
  const [orgs,setOrgs]=useState([])
  const [form,setForm]=useState({nome:'',descricao:'',homepage:'',owner:'',privado:false,issues:true,projects:true,wiki:false,discussions:false})
  const [repo,setRepo]=useState(null)
  const [file,setFile]=useState(null)
  const [storage,setStorage]=useState('r2')
  const [uploading,setUploading]=useState(false)
  const [uploadProgress,setUploadProgress]=useState({percent:0,phase:''})
  const [prepared,setPrepared]=useState(null)
  const [files,setFiles]=useState([])
  const [branch,setBranch]=useState('main')
  const [destPath,setDestPath]=useState('')
  const [message,setMessage]=useState('feat: primeiro commit')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const inputRef=useRef(null)
  const projectName=repo?.repo||form.nome.trim()
  const commit=useProjetosCommitStream(projectName)

  useEffect(()=>{githubService.orgs().then(r=>setOrgs(r.orgs||[])).catch(()=>setOrgs([]))},[])
  useEffect(()=>{
    if(commit.status==='success')setStep(6)
    if(commit.status==='error'&&step===5)setError(commit.relatorio?.msg||commit.eventos?.filter(x=>x.nivel==='error').slice(-1)[0]?.msg||'O commit não foi concluído.')
  },[commit.status,step])

  const ownerOptions=useMemo(()=>[{login:status?.login||'',label:`${status?.login||'Minha conta'} · pessoal`},...orgs.map(o=>({login:o.login,label:`${o.login} · organização`}))].filter(x=>x.login),[status?.login,orgs])

  function nextIdentity(){
    const nome=form.nome.trim()
    if(!/^[A-Za-z0-9._-]{1,100}$/.test(nome))return setError('Informe um nome válido para o repositório.')
    setError('');setStep(2)
  }

  async function createRepo(){
    setBusy(true);setError('')
    try{
      const selectedOwner=form.owner||status?.login||''
      const org=selectedOwner&&selectedOwner!==status?.login?selectedOwner:null
      const created=await githubService.criarRepo(form.nome.trim(),form.descricao.trim(),form.privado,org,{homepage:form.homepage.trim(),issues:form.issues,projects:form.projects,wiki:form.wiki,discussions:form.discussions})
      setRepo(created);setBranch(created.defaultBranch||'main');setMessage(`feat: primeiro commit de ${created.repo}`);setStep(3)
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }

  async function upload(){
    if(!file)return setError('Selecione um arquivo ZIP.')
    setUploading(true);setError('');setUploadProgress({percent:0,phase:'upload'})
    try{
      const result=await projetosService.uploadPersistente(storage,file,projectName,{substituir:true,onProgress:setUploadProgress})
      await projetosService.vincular(projectName,repo.owner,repo.repo)
      const detail=storage==='r2'?await projetosService.arquivosR2(projectName):await projetosService.detalheGridFS(projectName)
      const list=storage==='r2'?(detail.arquivos||[]).map(x=>x.relPath):flattenTree(detail.arvore)
      setFiles(list);setPrepared({...result,detail,storage});setStep(4)
    }catch(e){setError(e.message)}finally{setUploading(false)}
  }

  function startCommit(){
    setError('');setStep(5)
    commit.iniciarCommit({message:message.trim()||`feat: primeiro commit de ${projectName}`,branch:branch.trim()||'main',destPath:destPath.trim(),fonte:storage})
  }

  const currentTitle={1:'Nome e destino',2:'Detalhes do GitHub',3:'Enviar projeto',4:'Revisar commit',5:'Publicando',6:'Projeto pronto'}[step]
  const canClose=step!==5
  return <div className="gh-create-overlay" role="presentation">
    <div className="gh-create-modal" role="dialog" aria-modal="true" aria-label="Novo projeto GitHub">
      <div className="gh-create-head">
        <div><small>NOVO PROJETO GITHUB</small><h2>{currentTitle}</h2></div>
        {canClose&&<button type="button" onClick={onClose} aria-label="Fechar">×</button>}
      </div>
      <StepDots step={step}/>
      <div className="gh-create-body">
        {step===1&&<div className="gh-create-step">
          <p>Escolha onde o novo repositório será criado. Nada é enviado ainda.</p>
          <div className="gh-create-form one-screen">
            <label><span>Conta / organização</span><select value={form.owner||status?.login||''} onChange={e=>setForm(v=>({...v,owner:e.target.value}))}>{ownerOptions.map(o=><option key={o.login} value={o.login}>{o.label}</option>)}</select></label>
            <label><span>Nome do projeto *</span><input autoFocus value={form.nome} onChange={e=>setForm(v=>({...v,nome:e.target.value.replace(/\s+/g,'-')}))} placeholder="meu-projeto"/></label>
          </div>
          <button type="button" className={`gh-create-visibility ${form.privado?'private':''}`} onClick={()=>setForm(v=>({...v,privado:!v.privado}))}><span>{form.privado?'🔒':'🌐'}</span><div><b>{form.privado?'Privado':'Público'}</b><small>{form.privado?'Somente pessoas autorizadas.':'Visível publicamente no GitHub.'}</small></div></button>
          <div className="gh-create-actions"><DSBtn variant="primary" onClick={nextIdentity}>Continuar →</DSBtn></div>
        </div>}

        {step===2&&<div className="gh-create-step">
          <p>Complete os dados do GitHub. Ao continuar, o repositório vazio será criado.</p>
          <div className="gh-create-form one-screen">
            <label className="wide"><span>Descrição</span><textarea rows="2" maxLength="350" value={form.descricao} onChange={e=>setForm(v=>({...v,descricao:e.target.value}))} placeholder="O que este projeto faz?"/></label>
            <label className="wide"><span>Homepage / site</span><input value={form.homepage} onChange={e=>setForm(v=>({...v,homepage:e.target.value}))} placeholder="https://..."/></label>
          </div>
          <div className="gh-create-options compact">
            <label><input type="checkbox" checked={form.issues} onChange={e=>setForm(v=>({...v,issues:e.target.checked}))}/><b>Issues</b></label>
            <label><input type="checkbox" checked={form.projects} onChange={e=>setForm(v=>({...v,projects:e.target.checked}))}/><b>Projects</b></label>
            <label><input type="checkbox" checked={form.wiki} onChange={e=>setForm(v=>({...v,wiki:e.target.checked}))}/><b>Wiki</b></label>
            <label><input type="checkbox" checked={form.discussions} onChange={e=>setForm(v=>({...v,discussions:e.target.checked}))}/><b>Discussions</b></label>
          </div>
          <div className="gh-create-actions"><DSBtn variant="ghost" onClick={()=>setStep(1)}>Voltar</DSBtn><DSBtn variant="primary" onClick={createRepo} loading={busy}>Criar no GitHub →</DSBtn></div>
        </div>}

        {step===3&&<div className="gh-create-step">
          <div className="gh-create-created"><span>✓</span><div><b>{repo?.nomeCompleto}</b><small>Repositório criado. Agora envie o pacote que será preparado antes do primeiro commit.</small></div></div>
          <div className="gh-create-storage">
            <button className={storage==='r2'?'active':''} onClick={()=>setStorage('r2')}><b>☁️ R2</b><small>Recomendado para produção cloud.</small></button>
            <button className={storage==='gridfs'?'active':''} onClick={()=>setStorage('gridfs')}><b>▦ GridFS</b><small>Persistente no MongoDB.</small></button>
          </div>
          <button type="button" className={`gh-create-drop${file?' selected':''}`} onClick={()=>!uploading&&inputRef.current?.click()}>
            <input ref={inputRef} type="file" accept=".zip" hidden onChange={e=>setFile(e.target.files?.[0]||null)}/>
            <span>{file?'📦':'↑'}</span><b>{file?file.name:'Selecionar arquivo ZIP'}</b><small>{file?fmtBytes(file.size):'O servidor descompacta e prepara os arquivos.'}</small>
          </button>
          {uploading&&<div className="gh-create-upload"><div><span>{uploadProgress.phase==='upload'?'Enviando pacote':'Descompactando e salvando'}</span><b>{uploadProgress.percent||0}%</b></div><i><em style={{width:`${uploadProgress.percent||0}%`}}/></i></div>}
          <div className="gh-create-actions"><DSBtn variant="primary" onClick={upload} loading={uploading} disabled={!file}>Enviar e preparar →</DSBtn></div>
        </div>}

        {step===4&&<div className="gh-create-step">
          <div className="gh-create-created"><span>✓</span><div><b>{files.length} arquivo(s) preparados</b><small>{storage==='r2'?`Cloudflare R2 · ${prepared?.detail?.bucket||'bucket configurado'}`:'MongoDB GridFS'} · nenhum commit foi criado ainda.</small></div></div>
          <div className="gh-create-review-grid">
            <label><span>Branch</span><input value={branch} onChange={e=>setBranch(e.target.value)} placeholder="main"/></label>
            <label><span>Pasta no GitHub</span><input value={destPath} onChange={e=>setDestPath(e.target.value.replace(/^\/+|\/+$/g,''))} placeholder="/ (raiz)"/></label>
            <label className="wide"><span>Mensagem do commit</span><input value={message} onChange={e=>setMessage(e.target.value)} /></label>
          </div>
          <div className="gh-create-file-preview"><div><b>Prévia</b><span>{files.length}</span></div>{files.slice(0,8).map(f=><code key={f}>{f}</code>)}{files.length>8&&<small>+ {files.length-8} arquivo(s)</small>}</div>
          <div className="gh-create-destination"><span>Destino confirmado</span><b>{repo?.nomeCompleto} → {branch||'main'} → {destPath?`/${destPath}`:'/'}</b></div>
          <div className="gh-create-actions"><DSBtn variant="primary" onClick={startCommit}>Criar primeiro commit →</DSBtn></div>
        </div>}

        {step===5&&<div className="gh-create-step gh-create-commit">
          <div className="gh-create-stage-icon">{commit.status==='error'?'!':'↟'}</div>
          <h3>{commit.status==='error'?'O commit encontrou um problema':'Publicando no GitHub'}</h3>
          <p>{commit.etapaAtual?String(commit.etapaAtual).replaceAll('_',' '):'Preparando os arquivos...'}</p>
          <div className="gh-create-big-progress"><i style={{width:`${commit.progresso||0}%`}}/></div><strong>{commit.progresso||0}%</strong>
          {commit.stepData?.total&&<small>{commit.stepData.idx}/{commit.stepData.total} arquivos nesta etapa</small>}
          {commit.status==='error'&&<div className="gh-create-inline-error">{error||'Não foi possível concluir o commit.'}</div>}
          {commit.status==='error'&&<div className="gh-create-actions"><DSBtn variant="ghost" onClick={()=>setStep(4)}>Voltar</DSBtn><DSBtn variant="primary" onClick={startCommit}>Tentar novamente</DSBtn></div>}
        </div>}

        {step===6&&<div className="gh-create-step gh-create-finish">
          <div className="gh-create-finish-icon">✓</div><h3>Projeto publicado</h3>
          <p>O primeiro commit foi criado. Vercel e Render continuam opcionais e podem ser vinculados depois.</p>
          <div className="gh-create-destination"><span>GitHub</span><b>{repo?.nomeCompleto}@{branch||'main'}</b></div>
          <div className="gh-create-actions"><a className="gh-create-link" href={commit.relatorio?.relatorio?.commitUrl||repo?.url} target="_blank" rel="noreferrer">Abrir no GitHub ↗</a><DSBtn variant="primary" onClick={()=>{onCreated?.(repo);onClose?.()}}>Concluir</DSBtn></div>
        </div>}
        {error&&step!==5&&<div className="gh-create-inline-error">{error}</div>}
      </div>
      <style>{`
        .gh-create-overlay{position:fixed;inset:0;z-index:1800;background:rgba(15,23,42,.48);backdrop-filter:blur(3px);display:grid;place-items:center;padding:14px}.gh-create-modal{width:min(620px,100%);max-height:min(86dvh,700px);display:flex;flex-direction:column;overflow:hidden;background:var(--adm-surface);border:1px solid var(--adm-border);border-radius:20px;box-shadow:0 28px 80px rgba(15,23,42,.28)}.gh-create-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:14px 17px 9px;border-bottom:1px solid var(--adm-border)}.gh-create-head small{font-size:8px;font-weight:900;letter-spacing:.14em;color:var(--adm-muted)}.gh-create-head h2{margin:3px 0 0;font-size:17px;color:var(--adm-text)}.gh-create-head button{border:0;background:transparent;color:var(--adm-muted);font-size:22px;cursor:pointer}.gh-create-dots{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;padding:8px 17px}.gh-create-dots span{height:23px;border-radius:7px;display:grid;place-items:center;background:var(--adm-surface2);border:1px solid var(--adm-border);font-size:8px;font-weight:900;color:var(--adm-muted)}.gh-create-dots span.active{border-color:var(--adm-accent);color:var(--adm-accent)}.gh-create-dots span.done{background:color-mix(in srgb,var(--adm-green,#22c55e) 10%,var(--adm-surface));color:var(--adm-green,#16a34a)}.gh-create-body{overflow:auto;padding:0 17px 16px}.gh-create-step{display:grid;gap:11px;align-content:start}.gh-create-step>p{margin:0;color:var(--adm-muted);font-size:10px;line-height:1.45}.gh-create-form,.gh-create-review-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.gh-create-form label,.gh-create-review-grid label{display:grid;gap:4px}.gh-create-form label.wide,.gh-create-review-grid label.wide{grid-column:1/-1}.gh-create-form span,.gh-create-review-grid span{font-size:8px;font-weight:850;color:var(--adm-muted);text-transform:uppercase;letter-spacing:.05em}.gh-create-form input,.gh-create-form select,.gh-create-form textarea,.gh-create-review-grid input{width:100%;box-sizing:border-box;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2);color:var(--adm-text);padding:9px;font:inherit;font-size:10px;outline:none}.gh-create-visibility{display:flex;align-items:center;gap:9px;text-align:left;padding:10px;border:1px solid var(--adm-border);border-radius:10px;background:var(--adm-surface2);color:var(--adm-text);cursor:pointer}.gh-create-visibility>span{font-size:18px}.gh-create-visibility>div{display:grid;gap:1px}.gh-create-visibility b{font-size:10px}.gh-create-visibility small{font-size:8px;color:var(--adm-muted)}.gh-create-options{display:grid;grid-template-columns:1fr 1fr;gap:6px}.gh-create-options label{display:flex;align-items:center;gap:7px;padding:8px;border:1px solid var(--adm-border);border-radius:9px;background:var(--adm-surface2)}.gh-create-options b{font-size:9px;color:var(--adm-text)}.gh-create-actions{display:flex;justify-content:flex-end;gap:7px;align-items:center}.gh-create-created{display:grid;grid-template-columns:30px minmax(0,1fr);gap:9px;align-items:center;padding:9px;border:1px solid color-mix(in srgb,var(--adm-green,#22c55e) 35%,var(--adm-border));border-radius:10px;background:color-mix(in srgb,var(--adm-green,#22c55e) 7%,var(--adm-surface))}.gh-create-created>span{width:29px;height:29px;display:grid;place-items:center;border-radius:9px;background:var(--adm-green,#22c55e);color:white;font-weight:900}.gh-create-created div{display:grid;gap:1px;min-width:0}.gh-create-created b{font-size:10px;color:var(--adm-text);overflow-wrap:anywhere}.gh-create-created small{font-size:8px;color:var(--adm-muted);line-height:1.35}.gh-create-storage{display:grid;grid-template-columns:1fr 1fr;gap:7px}.gh-create-storage button{display:grid;gap:2px;text-align:left;padding:9px;border-radius:10px;border:1px solid var(--adm-border);background:var(--adm-surface2);color:var(--adm-text);cursor:pointer}.gh-create-storage button.active{border-color:var(--adm-accent);box-shadow:inset 0 0 0 1px var(--adm-accent)}.gh-create-storage b{font-size:10px}.gh-create-storage small{font-size:7px;color:var(--adm-muted)}.gh-create-drop{width:100%;display:grid;place-items:center;gap:3px;padding:15px 10px;border:1.5px dashed var(--adm-border);border-radius:11px;background:var(--adm-surface2);color:var(--adm-text);cursor:pointer}.gh-create-drop.selected{border-color:var(--adm-accent)}.gh-create-drop>span{font-size:20px}.gh-create-drop>b{font-size:10px}.gh-create-drop>small{font-size:8px;color:var(--adm-muted)}.gh-create-upload>div{display:flex;justify-content:space-between;font-size:8px;color:var(--adm-muted);margin-bottom:4px}.gh-create-upload>i,.gh-create-big-progress{display:block;height:7px;border-radius:999px;background:var(--adm-surface2);overflow:hidden}.gh-create-upload em,.gh-create-big-progress i{display:block;height:100%;background:var(--adm-accent);border-radius:inherit;transition:width .3s}.gh-create-file-preview{max-height:104px;overflow:auto;border:1px solid var(--adm-border);border-radius:9px;padding:8px;display:grid;gap:3px;background:var(--adm-surface2)}.gh-create-file-preview>div{display:flex;justify-content:space-between;color:var(--adm-text);font-size:9px}.gh-create-file-preview code{font-size:7px;color:var(--adm-muted);overflow-wrap:anywhere}.gh-create-file-preview small{font-size:7px;color:var(--adm-accent);font-weight:800}.gh-create-destination{display:grid;gap:2px;padding:9px;border-radius:9px;background:var(--adm-surface2);border:1px solid var(--adm-border)}.gh-create-destination span{font-size:7px;color:var(--adm-muted);text-transform:uppercase;font-weight:850}.gh-create-destination b{font-size:9px;color:var(--adm-text);overflow-wrap:anywhere}.gh-create-commit,.gh-create-finish{text-align:center;justify-items:center;padding:8px 0}.gh-create-stage-icon,.gh-create-finish-icon{width:48px;height:48px;display:grid;place-items:center;border-radius:15px;background:color-mix(in srgb,var(--adm-accent) 10%,var(--adm-surface2));color:var(--adm-accent);font-size:23px;font-weight:900}.gh-create-finish-icon{background:color-mix(in srgb,var(--adm-green,#22c55e) 12%,var(--adm-surface2));color:var(--adm-green,#16a34a)}.gh-create-commit h3,.gh-create-finish h3{margin:0;font-size:15px;color:var(--adm-text)}.gh-create-commit>p,.gh-create-finish>p{margin:0;max-width:420px}.gh-create-big-progress{width:min(410px,100%);height:9px}.gh-create-commit>strong{font-size:18px;color:var(--adm-accent)}.gh-create-inline-error{padding:8px 9px;border:1px solid color-mix(in srgb,var(--adm-red,#ef4444) 45%,var(--adm-border));border-radius:9px;background:color-mix(in srgb,var(--adm-red,#ef4444) 8%,var(--adm-surface));color:var(--adm-red,#dc2626);font-size:9px;line-height:1.4}.gh-create-link{display:inline-flex;align-items:center;min-height:33px;padding:0 11px;border-radius:9px;border:1px solid var(--adm-border);color:var(--adm-accent);font-size:9px;font-weight:800;text-decoration:none}
        @media(max-width:560px){.gh-create-overlay{padding:8px;place-items:center}.gh-create-modal{width:100%;max-height:90dvh;border-radius:15px}.gh-create-head{padding:11px 12px 7px}.gh-create-head h2{font-size:15px}.gh-create-dots{padding:7px 12px;gap:3px}.gh-create-dots span{height:20px;font-size:7px}.gh-create-body{padding:0 12px 11px}.gh-create-form,.gh-create-review-grid{grid-template-columns:1fr}.gh-create-form label.wide,.gh-create-review-grid label.wide{grid-column:auto}.gh-create-options{grid-template-columns:1fr 1fr;gap:4px}.gh-create-options label{padding:6px}.gh-create-options b{font-size:8px}.gh-create-storage button{padding:8px}.gh-create-storage small{display:none}.gh-create-drop{padding:12px 8px}.gh-create-actions>*{flex:1;justify-content:center}.gh-create-file-preview{max-height:86px}.gh-create-step{gap:9px}}
        @media(max-height:620px){.gh-create-modal{max-height:94dvh}.gh-create-head{padding-top:8px}.gh-create-dots{padding-top:5px;padding-bottom:5px}.gh-create-body{padding-bottom:8px}.gh-create-step{gap:7px}.gh-create-step>p{font-size:9px}.gh-create-drop{padding:9px}.gh-create-file-preview{max-height:70px}}
      `}</style>
    </div>
  </div>
}
