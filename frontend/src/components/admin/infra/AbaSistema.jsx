/**
 * AbaSistema.jsx — Saúde do servidor.
 *
 * A visão padrão mostra apenas métricas úteis no dia a dia. Informações de
 * depuração (PID, caminhos, rede, V8 detalhado) ficam recolhidas em
 * "Detalhes avançados" para não poluir a central de infraestrutura.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { infraestruturaService } from '../../../services/api'
import toast from 'react-hot-toast'
import { C, Ico, Spin, formatBytes, PageCard, SectionTitle, BarraProgresso } from './InfraBase'
import { FONT } from '../../../themes/tokens'

function Sparkline({ data = [], color = '#22c55e', height = 32, width = 120 }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1), min = Math.min(...data, 0), range = max - min || 1
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * width).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`).join(' ')
  const last = data[data.length - 1]
  return <svg width={width} height={height} style={{ display:'block', overflow:'visible', maxWidth:'100%' }} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8"/><circle cx={width} cy={height - ((last - min) / range) * height} r="2.5" fill={color}/></svg>
}

function corCarga(loadAvg, cores) { const ratio = loadAvg / (cores || 1); return ratio > 1.5 ? '#ef4444' : ratio > .8 ? '#f59e0b' : '#22c55e' }
function corMemoria(v) { return v > 90 ? '#ef4444' : v > 75 ? '#f59e0b' : '#22c55e' }
const INTERVALOS = [['Off',0],['10 s',10000],['30 s',30000],['1 min',60000]]
const MAX_HIST = 40

function Summary({ metricas }) {
  const { cpu, memoria, v8: v8Stats, processo } = metricas || {}
  const loadPct = cpu?.cores ? Math.min(100, ((cpu.loadAvg1min || 0) / cpu.cores) * 100) : 0
  const cards = [
    ['CPU', cpu?.loadAvg1min?.toFixed(2) ?? '—', cpu?.cores ? `${cpu.cores} cores · ${loadPct.toFixed(0)}%` : 'Carga do sistema', corCarga(cpu?.loadAvg1min || 0, cpu?.cores), loadPct],
    ['RAM', memoria?.usoPercentual != null ? `${memoria.usoPercentual.toFixed(1)}%` : '—', memoria?.total ? `${formatBytes(memoria.usada)} / ${formatBytes(memoria.total)}` : 'Memória do host', corMemoria(memoria?.usoPercentual || 0), memoria?.usoPercentual || 0],
    ['HEAP', v8Stats?.usoPercentual != null ? `${v8Stats.usoPercentual.toFixed(1)}%` : '—', v8Stats?.usedHeapSize ? `${formatBytes(v8Stats.usedHeapSize)} usados` : 'Memória Node.js', corMemoria(v8Stats?.usoPercentual || 0), v8Stats?.usoPercentual || 0],
    ['UPTIME', processo?.uptimeFormatado || '—', 'Processo Node.js', '#22c55e', null],
  ]
  return <div className="server-summary">{cards.map(([label,value,sub,color,p])=><div key={label}><span style={{background:color}}/><small>{label}</small><b>{value}</b><em>{sub}</em>{p != null && <div className="server-mini-progress"><i style={{width:`${Math.min(100,p)}%`,background:color}}/></div>}</div>)}</div>
}

function Alerts({ metricas }) {
  const a=[]; const { cpu, memoria }=metricas||{}; const ratio=cpu?.cores?(cpu.loadAvg1min||0)/cpu.cores:0
  if(ratio>.8)a.push(`CPU ${ratio>1.5?'crítica':'elevada'}: ${(ratio*100).toFixed(0)}% da capacidade relativa`)
  if((memoria?.usoPercentual||0)>75)a.push(`Memória ${memoria.usoPercentual>90?'crítica':'alta'}: ${memoria.usoPercentual.toFixed(1)}% em uso`)
  if(!a.length)return null
  return <div className="server-alerts">{a.map(x=><div key={x}>⚠ <span>{x}</span></div>)}</div>
}

export default function AbaSistema() {
  const [metricas,setMetricas]=useState(null),[carregando,setCarregando]=useState(true),[intervalo,setIntervalo]=useState(10000),[ultimo,setUltimo]=useState(null)
  const hist=useRef({load:[],mem:[],heap:[]})
  const carregar=useCallback(async(silent=false)=>{if(!silent)setCarregando(true);try{const d=await infraestruturaService.sistemaMetricas();setMetricas(d);setUltimo(new Date());hist.current.load=[...hist.current.load.slice(-(MAX_HIST-1)),d.cpu?.loadAvg1min||0];hist.current.mem=[...hist.current.mem.slice(-(MAX_HIST-1)),d.memoria?.usoPercentual||0];hist.current.heap=[...hist.current.heap.slice(-(MAX_HIST-1)),d.v8?.usoPercentual||0]}catch(e){if(!silent)toast.error(e.message||'Erro ao carregar métricas')}finally{if(!silent)setCarregando(false)}},[])
  useEffect(()=>{carregar()},[carregar])
  useEffect(()=>{if(!intervalo)return;const id=setInterval(()=>carregar(true),intervalo);return()=>clearInterval(id)},[intervalo,carregar])
  if(carregando&&!metricas)return <div style={{display:'flex',justifyContent:'center',padding:60}}><Spin size={24}/></div>

  const {cpu,memoria,v8:v8Stats,sistema,processo,rede}=metricas||{}
  const cpuPct=cpu?.cores?Math.min(100,((cpu.loadAvg1min||0)/cpu.cores)*100):0
  return <div className="server-health">
    <Summary metricas={metricas}/><Alerts metricas={metricas}/>
    <div className="server-refresh"><div><b>Atualização automática</b><span>{ultimo?`Última leitura ${ultimo.toLocaleTimeString('pt-BR')}`:'Aguardando leitura'}</span></div><div>{INTERVALOS.map(([l,ms])=><button key={ms} className={intervalo===ms?'active':''} onClick={()=>setIntervalo(ms)}>{l}</button>)}<button onClick={()=>carregar()} disabled={carregando}>↻ Atualizar</button></div></div>

    <div className="server-main-grid">
      <PageCard><SectionTitle icon={Ico.cpu}>Processador</SectionTitle><p className="server-device">{cpu?.modelo||'—'} · {cpu?.cores||'—'} cores</p><div className="server-value-row"><span>Carga relativa</span><b style={{color:corCarga(cpu?.loadAvg1min||0,cpu?.cores)}}>{cpuPct.toFixed(0)}%</b></div><BarraProgresso pct={cpuPct} color={corCarga(cpu?.loadAvg1min||0,cpu?.cores)}/><div className="server-metrics"><div><span>1 min</span><b>{cpu?.loadAvg1min?.toFixed(2)??'—'}</b></div><div><span>5 min</span><b>{cpu?.loadAvg5min?.toFixed(2)??'—'}</b></div><div><span>15 min</span><b>{cpu?.loadAvg15min?.toFixed(2)??'—'}</b></div></div>{hist.current.load.length>1&&<Sparkline data={hist.current.load} color={corCarga(cpu?.loadAvg1min||0,cpu?.cores)} width={300} height={34}/>}</PageCard>
      <PageCard><SectionTitle icon={Ico.memory}>Memória RAM</SectionTitle><div className="server-value-row"><span>Uso do host</span><b style={{color:corMemoria(memoria?.usoPercentual||0)}}>{memoria?.usoPercentual?.toFixed(1)??'—'}%</b></div><BarraProgresso pct={memoria?.usoPercentual||0} color={corMemoria(memoria?.usoPercentual||0)}/><div className="server-metrics"><div><span>Total</span><b>{formatBytes(memoria?.total)}</b></div><div><span>Usada</span><b>{formatBytes(memoria?.usada)}</b></div><div><span>Livre</span><b>{formatBytes(memoria?.livre)}</b></div></div>{hist.current.mem.length>1&&<Sparkline data={hist.current.mem} color={corMemoria(memoria?.usoPercentual||0)} width={300} height={34}/>}</PageCard>
      <PageCard><SectionTitle icon={Ico.info}>Heap Node.js</SectionTitle><div className="server-value-row"><span>Uso do limite V8</span><b style={{color:corMemoria(v8Stats?.usoPercentual||0)}}>{v8Stats?.usoPercentual?.toFixed(1)??'—'}%</b></div><BarraProgresso pct={v8Stats?.usoPercentual||0} color={corMemoria(v8Stats?.usoPercentual||0)}/><div className="server-metrics"><div><span>Usado</span><b>{formatBytes(v8Stats?.usedHeapSize)}</b></div><div><span>Alocado</span><b>{formatBytes(v8Stats?.totalHeapSize)}</b></div><div><span>Limite</span><b>{formatBytes(v8Stats?.heapSizeLimit)}</b></div></div>{hist.current.heap.length>1&&<Sparkline data={hist.current.heap} color={corMemoria(v8Stats?.usoPercentual||0)} width={300} height={34}/>}</PageCard>
      <PageCard><SectionTitle icon={Ico.info}>Disponibilidade</SectionTitle><div className="server-uptime"><b>{processo?.uptimeFormatado||'—'}</b><span>Processo Node.js</span></div><div className="server-metrics"><div><span>Node.js</span><b>{processo?.versaoNode||'—'}</b></div><div><span>AL Sistemas</span><b>{processo?.versaoApp||'—'}</b></div><div><span>SO</span><b>{sistema?.so||'—'} {sistema?.arquitetura||''}</b></div></div></PageCard>
    </div>

    <details className="server-advanced"><summary>Detalhes avançados de diagnóstico</summary><p>Informações técnicas ficam recolhidas por padrão porque raramente são necessárias no uso cotidiano.</p><div className="server-advanced-grid"><div><small>SISTEMA</small><b>{sistema?.hostname||'—'}</b><span>{sistema?.so||'—'} {sistema?.versaoSo||''} · {sistema?.plataforma||'—'} · {sistema?.arquitetura||'—'}</span><code>tmp: {sistema?.tmpdir||'—'}</code></div><div><small>PROCESSO</small><b>PID {processo?.pid??'—'} · PPID {processo?.ppid??'—'}</b><span>{processo?.handles??'—'} handles · {processo?.requests??'—'} requests</span><code>{processo?.cwd||'—'}</code></div><div><small>V8 / PROCESSO</small><b>RSS {formatBytes(memoria?.rss)}</b><span>Heap usado {formatBytes(memoria?.heapUsed)} · externo {formatBytes(memoria?.externo)}</span><code>malloc {formatBytes(v8Stats?.mallocedMemory)}</code></div><div><small>REDE</small><b>{rede?.interfaces?.length||0} interface(s) externa(s)</b><span>{(rede?.interfaces||[]).map(x=>`${x.nome}: ${x.endereco}`).join(' · ')||'Nenhuma interface externa detectada'}</span></div></div></details>

    <style>{`
      .server-health{display:grid;gap:14px}.server-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.server-summary>div{position:relative;overflow:hidden;display:grid;gap:3px;padding:13px;border:1px solid var(--adm-border);border-radius:13px;background:var(--adm-surface)}.server-summary>div>span:first-child{position:absolute;inset:0 0 auto;height:2px}.server-summary small{font-size:${FONT.xs}px;font-weight:850;letter-spacing:.06em;color:var(--adm-muted)}.server-summary b{font-size:18px;color:var(--adm-text)}.server-summary em{font-style:normal;font-size:${FONT.sm}px;color:var(--adm-muted)}.server-mini-progress{height:3px;margin-top:4px;border-radius:999px;background:var(--adm-border);overflow:hidden}.server-mini-progress i{display:block;height:100%;border-radius:999px}.server-alerts{display:grid;gap:7px}.server-alerts>div{padding:10px 12px;border:1px solid color-mix(in srgb,var(--adm-amber) 30%,var(--adm-border));border-radius:10px;background:color-mix(in srgb,var(--adm-amber) 7%,var(--adm-surface));font-size:${FONT.base}px;color:var(--adm-amber)}.server-alerts span{color:var(--adm-text);font-weight:650}.server-refresh{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--adm-border);border-radius:12px;background:var(--adm-surface)}.server-refresh>div:first-child{display:grid;gap:2px}.server-refresh b{font-size:${FONT.base}px}.server-refresh span{font-size:${FONT.sm}px;color:var(--adm-muted)}.server-refresh>div:last-child{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.server-refresh button{min-height:36px;border:1px solid var(--adm-border);border-radius:999px;padding:6px 10px;background:var(--adm-surface2);color:var(--adm-text);font-size:${FONT.sm}px;font-weight:750}.server-refresh button.active{background:var(--adm-accent);border-color:var(--adm-accent);color:#fff}.server-main-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.server-device{margin:-4px 0 11px;color:var(--adm-muted);font-size:${FONT.sm}px;line-height:1.45}.server-value-row{display:flex;justify-content:space-between;gap:10px;margin-bottom:5px;font-size:${FONT.base}px;color:var(--adm-muted)}.server-value-row b{color:var(--adm-text)}.server-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:11px 0}.server-metrics>div{display:grid;gap:2px;min-width:0}.server-metrics span{font-size:${FONT.sm}px;color:var(--adm-muted)}.server-metrics b{font-size:${FONT.base}px;overflow-wrap:anywhere}.server-uptime{display:grid;gap:3px;margin-bottom:12px}.server-uptime b{font-size:22px}.server-uptime span{font-size:${FONT.sm}px;color:var(--adm-muted)}.server-advanced{border:1px solid var(--adm-border);border-radius:13px;background:var(--adm-surface)}.server-advanced summary{cursor:pointer;padding:13px 14px;font-size:${FONT.base}px;font-weight:850;color:var(--adm-text)}.server-advanced>p{margin:0;padding:0 14px 12px;font-size:${FONT.sm}px;color:var(--adm-muted)}.server-advanced-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 12px 12px}.server-advanced-grid>div{display:grid;gap:4px;padding:11px;border-radius:10px;background:var(--adm-surface2);min-width:0}.server-advanced-grid small{font-size:${FONT.xs}px;font-weight:850;letter-spacing:.06em;color:var(--adm-muted)}.server-advanced-grid b{font-size:${FONT.base}px}.server-advanced-grid span,.server-advanced-grid code{font-size:${FONT.sm}px;line-height:1.45;color:var(--adm-muted);overflow-wrap:anywhere;word-break:break-word}.server-advanced-grid code{font-family:var(--adm-mono)}
      @media(max-width:720px){.server-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.server-main-grid{grid-template-columns:1fr}.server-refresh{align-items:flex-start;flex-direction:column}.server-refresh>div:last-child{justify-content:flex-start}.server-advanced-grid{grid-template-columns:1fr}}
      @media(max-width:390px){.server-summary{grid-template-columns:1fr 1fr}.server-metrics{grid-template-columns:1fr 1fr}}
    `}</style>
  </div>
}
