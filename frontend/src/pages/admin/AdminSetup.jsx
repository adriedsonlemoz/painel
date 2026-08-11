/**
 * AdminSetup.jsx — Instalador do AL Sistemas (componente-roteador).
 *
 * Gerencia apenas as 4 fases do instalador:
 *   verificando → instalar | painel → sucesso
 *
 * Toda a UI foi extraída para:
 *   components/admin/setup/SetupForms.jsx    — primitivos e dados
 *   components/admin/setup/ConfigMongo.jsx   — painel MongoDB
 *   components/admin/setup/ConfigCloudinary.jsx — painel Cloudinary
 */
import { useState, useEffect } from 'react'
import { setupService }        from '../../services/api'
import toast                   from 'react-hot-toast'

import {
  C, SETUP, Ico, Spin, wrap, card, labelSty, inputSty, errMsg,
  btnSty, infoBox, divider, secTitle,
  Campo, Check, CampoAcessoFixo, RegrasSenha,
  StatusBadge, SeletorDados, OPCOES_SEED,
} from '../../components/admin/setup/SetupForms'
import ConfigMongo      from '../../components/admin/setup/ConfigMongo'
import ConfigCloudinary from '../../components/admin/setup/ConfigCloudinary'
import ConfigIntegracoes from '../../components/admin/setup/ConfigIntegracoes'
import SetupWizard        from '../../components/admin/setup/SetupWizard'
import { SPACE, RADIUS, FONT } from '../../themes/tokens'
import SetupStartupDiagnostics from '../../components/SetupStartupDiagnostics'

/* ═══════════════════════════════════════════════════════════════
   TELA — Verificando
═══════════════════════════════════════════════════════════════ */
function TelaVerificando({ startedAt }) {
  return (
    <div style={{ ...wrap, background: '#f8faf9' }}>
      <SetupStartupDiagnostics
        startedAt={startedAt}
        stages={[
          { label: 'Interface do assistente', status: 'done', elapsed: 0, detail: 'AdminSetup carregado' },
          { label: 'Lendo estado da instalação', status: 'running', startedAt, detail: 'GET /api/setup/status (somente configuração local)' },
          { label: 'Montando formulário', status: 'pending', detail: 'Aguardando o estado acima' },
        ]}
      />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   TELA — Formulário de instalação
═══════════════════════════════════════════════════════════════ */
function TelaInstalacao({ onSucesso, statusBanco }) {
  return <SetupWizard statusBanco={statusBanco} onSucesso={onSucesso} />
}

/* ═══════════════════════════════════════════════════════════════
   TELA — Sucesso
═══════════════════════════════════════════════════════════════ */
function TelaSucesso({ resultado, onIrPainel }) {
  const [desativarStatus, setDesativarStatus] = useState(null)
  const [desativarMsg,    setDesativarMsg]    = useState('')

  async function handleDesativar() {
    setDesativarStatus('loading')
    try {
      const data = await setupService.desativarArquivo()
      setDesativarStatus('done')
      setDesativarMsg(data.mensagem || 'Setup desativado com sucesso!')
    } catch (err) {
      setDesativarStatus('error')
      setDesativarMsg(err.message || 'Erro ao desativar setup.')
    }
  }

  return (
    <div style={wrap}>
      <div style={{ width: '100%', maxWidth: 500, textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, margin: '0 auto 16px', borderRadius: 20, display: 'grid', placeItems: 'center', background: SETUP.successSoft, color: SETUP.success, border: `1px solid ${SETUP.success}22` }}>{Ico.check}</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: SETUP.text, marginBottom: 6 }}>Instalação concluída!</h2>
        <p style={{ color: SETUP.muted, fontSize: FONT.md, marginBottom: 24 }}>
          O sistema foi configurado e você já está autenticado.
        </p>

        {resultado?.usuario && (
          <div style={{ ...card({ textAlign: 'left' }), marginBottom: 14 }}>
            <p style={secTitle}>Conta criada</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: FONT.base }}>
                <span style={{ color: SETUP.muted }}>Nome</span>
                <strong style={{ color: SETUP.text }}>{resultado.usuario.nome}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: FONT.base }}>
                <span style={{ color: SETUP.muted }}>Email</span>
                <strong style={{ color: SETUP.text }}>{resultado.usuario.email}</strong>
              </div>
            </div>
          </div>
        )}

        {resultado?.perfis_criados?.length > 0 && (
          <div style={{ ...card({ textAlign: 'left' }), marginBottom: 14 }}>
            <p style={secTitle}>Perfis de acesso criados</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
              {resultado.perfis_criados.map(p => (
                <span key={p} style={{ padding: '4px 10px', borderRadius: RADIUS.pill, fontSize: FONT.sm, fontWeight: 600, background: SETUP.successSoft, color: SETUP.success, border: `1px solid ${SETUP.success}22` }}>{p}</span>
              ))}
            </div>
          </div>
        )}

        {resultado?.seed && Object.values(resultado.seed).some(v => v > 0) && (
          <div style={{ ...card({ textAlign: 'left' }), marginBottom: 14 }}>
            <p style={secTitle}>Dados de exemplo importados</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
              {Object.entries(resultado.seed).filter(([, v]) => v > 0).map(([k, v]) => (
                <span key={k} style={{ padding: '4px 10px', borderRadius: RADIUS.pill, fontSize: FONT.sm, fontWeight: 600, background: SETUP.blueSoft, color: SETUP.blue, border: `1px solid ${SETUP.blue}22` }}>{k}: {v}</span>
              ))}
            </div>
          </div>
        )}

        {resultado?.seed_erro && (
          <div style={{ ...infoBox(SETUP.warning), textAlign: 'left', marginBottom: 14 }}>
            <span style={{ color: SETUP.warning, flexShrink: 0 }}>{Ico.warn}</span>
            <div style={{ fontSize: FONT.base, color: SETUP.warning, lineHeight: 1.5 }}>
              <strong>Dados de exemplo não importados:</strong><br/>
              {resultado.seed_erro}<br/>
              <span style={{ opacity: .8 }}>Você pode importá-los depois em <strong>Gerenciar Banco → Importar Seed</strong>.</span>
            </div>
          </div>
        )}

        {/* Segurança pós-instalação */}
        <div style={{ ...card({ textAlign: 'left' }), marginBottom: 20, borderColor: desativarStatus === 'done' ? `${SETUP.success}55` : SETUP.border }}>
          <p style={secTitle}>🔒 Segurança pós-instalação</p>
          {desativarStatus === 'done' ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke={SETUP.success} strokeWidth="2.2" width="16" height="16" style={{ flexShrink: 0, marginTop: 1 }}><polyline points="20 6 9 17 4 12"/></svg>
              <div>
                <p style={{ fontSize: FONT.base, color: SETUP.success, fontWeight: 700, marginBottom: 3 }}>Setup desativado com sucesso!</p>
                <p style={{ fontSize: FONT.sm, color: SETUP.muted, lineHeight: 1.5 }}>{desativarMsg}</p>
              </div>
            </div>
          ) : desativarStatus === 'error' ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
              <span style={{ color: SETUP.warning, flexShrink: 0 }}>{Ico.warn}</span>
              <p style={{ fontSize: FONT.sm, color: SETUP.warning, lineHeight: 1.5 }}>{desativarMsg}</p>
            </div>
          ) : (
            <p style={{ fontSize: FONT.base, color: SETUP.muted, lineHeight: 1.6, marginBottom: SPACE.lg }}>
              A instalação inicial será bloqueada automaticamente após a criação do administrador.
            </p>
          )}
          {desativarStatus !== 'done' && desativarStatus !== 'confirm' && (
            <button onClick={() => setDesativarStatus('confirm')} disabled={desativarStatus === 'loading'}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: RADIUS.md, border: `1px solid ${SETUP.danger}33`, background: SETUP.dangerSoft, color: SETUP.danger, fontSize: FONT.base, fontWeight: 600, cursor: 'pointer' }}>
              {Ico.trash} Finalizar proteção do setup
            </button>
          )}
          {desativarStatus === 'confirm' && (
            <div style={{ background: SETUP.dangerSoft, border: `1px solid ${SETUP.danger}33`, borderRadius: RADIUS.md, padding: '12px 14px' }}>
              <p style={{ fontSize: FONT.base, color: SETUP.danger, marginBottom: 10, lineHeight: 1.5 }}>
                <strong>Atenção:</strong> Esta ação irá desativar as rotas de setup. Tem certeza?
              </p>
              <div style={{ display: 'flex', gap: SPACE.md }}>
                <button onClick={handleDesativar} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, padding: '8px 0', borderRadius: RADIUS.md, border: 'none', background: SETUP.danger, color: '#ffffff', fontSize: FONT.base, fontWeight: 700, cursor: 'pointer' }}>
                  {Ico.trash} Sim, desativar
                </button>
                <button onClick={() => setDesativarStatus(null)} style={{ flex: 1, padding: '8px 0', borderRadius: RADIUS.md, border: `1px solid ${SETUP.border}`, background: SETUP.surface, color: SETUP.muted, fontSize: FONT.base, fontWeight: 600, cursor: 'pointer' }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {desativarStatus === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, color: C.muted, fontSize: FONT.base }}>
              <Spin size={13}/> Finalizando proteção…
            </div>
          )}
        </div>

        <button onClick={onIrPainel} style={{ ...btnSty('green'), width: 'auto', padding: '12px 40px', fontSize: 14 }}>
          {Ico.arrow} Entrar no Painel
        </button>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   TELA — Painel de banco (já instalado)
═══════════════════════════════════════════════════════════════ */
function PainelBanco({ status: statusInicial, onConcluido }) {
  const [nomeSite, setNomeSite] = useState('AL Sistemas')
  const [dadosSel, setDadosSel] = useState(OPCOES_SEED.map(o => o.id))
  const [limpar, setLimpar]     = useState(false)
  const [mantUser, setMantUser] = useState(true)
  const [resetTxt, setResetTxt] = useState('')
  const [loading, setLoading]   = useState('')
  const [contagens, setContagens] = useState(statusInicial?.contagens ?? {})
  const [bancoDone, setBancoDone] = useState(null)
  const [envConfig, setEnvConfig] = useState({})

  useEffect(() => {
    setupService.lerEnvConfig().then(data => setEnvConfig(data)).catch(() => {})
  }, [])

  async function recarregarContagens() {
    try { const s = await setupService.status(); setContagens(s.contagens ?? {}) } catch {}
  }

  async function importarSeed() {
    setLoading('seed'); setBancoDone(null)
    try {
      const res = await setupService.seed({ nome_site: nomeSite, limpar_antes: limpar, dados_escolhidos: dadosSel })
      const msg = res.mensagem || 'Dados importados com sucesso!'
      toast.success(msg)
      setBancoDone({ tipo: 'seed', msg })
      await recarregarContagens()
      onConcluido?.({ seed: res.importados, mensagem: msg })
    } catch (err) { toast.error(err.message || 'Erro ao importar') }
    finally { setLoading('') }
  }

  async function resetarBanco() {
    if (resetTxt !== 'CONFIRMAR_RESET') { toast.error('Digite CONFIRMAR_RESET'); return }
    setLoading('reset'); setBancoDone(null)
    try {
      await setupService.resetDb({ confirmar: resetTxt, manter_usuarios: mantUser })
      toast.success('Banco resetado!')
      setTimeout(() => window.location.reload(), 1200)
    } catch (err) { toast.error(err.message || 'Erro ao resetar') }
    finally { setLoading('') }
  }

  const cnt = contagens

  return (
    <div style={{ minHeight: '100vh', background: C.pageBg, fontFamily: "'Geist','Segoe UI',system-ui,sans-serif", padding: '16px 10px' }}>
      <div style={{ maxWidth: 540, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 4 }}>Gerenciar Banco de Dados</h2>
        <p style={{ fontSize: FONT.base, color: C.muted, marginBottom: 24 }}>
          Banco: <strong style={{ color: C.subtle }}>{statusInicial?.banco_nome ?? '—'}</strong>
        </p>

        {bancoDone && (
          <div style={{ ...infoBox(bancoDone.tipo === 'reset' ? C.orange : C.greenAcc), marginBottom: 20 }}>
            <span style={{ color: bancoDone.tipo === 'reset' ? C.orange : C.greenAcc, flexShrink: 0 }}>
              {bancoDone.tipo === 'reset' ? Ico.trash : Ico.seed}
            </span>
            <span style={{ fontSize: FONT.base, color: bancoDone.tipo === 'reset' ? '#fdba74' : '#86efac', lineHeight: 1.5 }}>
              {bancoDone.msg}
            </span>
          </div>
        )}

        <ConfigMongo initialUri={envConfig.mongo_uri} />
        
        <ConfigIntegracoes />
        <div style={{ marginBottom: SPACE.md }} />

        {/* Estado atual */}
        <div style={{ ...card(), marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, marginBottom: 14 }}>
            <span style={{ color: C.blue }}>{Ico.db}</span>
            <span style={{ fontSize: FONT.md, fontWeight: 700, color: C.text }}>Estado atual</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.md }}>
            {Object.entries(cnt).map(([k, v]) => (
              <div key={k} style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: '7px 14px', textAlign: 'center', minWidth: 64 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: v > 0 ? C.greenAcc : C.muted }}>{v}</div>
                <div style={{ fontSize: FONT.xs, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{k}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Importar seed */}
        <div style={{ ...card(), marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, marginBottom: 14 }}>
            <span style={{ color: C.greenAcc }}>{Ico.seed}</span>
            <span style={{ fontSize: FONT.md, fontWeight: 700, color: C.text }}>Importar dados de exemplo</span>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelSty}>Nome do site nos dados</label>
            <input value={nomeSite} onChange={e => setNomeSite(e.target.value)} style={inputSty()} placeholder="Ex.: AL Sistemas" />
          </div>
          <div style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '14px 14px 4px', marginBottom: 14 }}>
            <SeletorDados selecionados={dadosSel} onChange={setDadosSel} />
          </div>
          <Check checked={limpar} onChange={setLimpar} warnMode color={C.red}
            label="Limpar dados existentes antes de importar"
            desc="Remove notícias, categorias, eventos e ônibus antes de recriar os exemplos." />
          {limpar && (
            <div style={{ ...infoBox(SETUP.warning), marginBottom: 14 }}>
              <span style={{ color: SETUP.warning, flexShrink: 0 }}>{Ico.warn}</span>
              <span style={{ fontSize: FONT.sm, color: SETUP.warning, lineHeight: 1.5 }}>
                Todas as notícias, categorias, eventos e ônibus serão excluídos antes da importação.
              </span>
            </div>
          )}
          <button onClick={importarSeed} disabled={loading === 'seed'} style={btnSty(limpar ? 'danger' : 'green', loading === 'seed')}>
            {loading === 'seed' ? <><Spin/> Importando…</> : <>{Ico.seed} Importar Seed</>}
          </button>
        </div>

        {/* Reset total */}
        <div style={{ ...card({ border: `1px solid ${C.red}44` }) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, marginBottom: 14 }}>
            <span style={{ color: C.red }}>{Ico.trash}</span>
            <span style={{ fontSize: FONT.md, fontWeight: 700, color: C.text }}>Reset do banco</span>
          </div>
          <div style={{ ...infoBox(C.red), marginBottom: 14 }}>
            <span style={{ color: C.red, flexShrink: 0, marginTop: 1 }}>{Ico.warn}</span>
            <span style={{ fontSize: FONT.sm, color: '#fca5a5', lineHeight: 1.5 }}>
              Ação <strong>irreversível</strong>. Todo conteúdo será apagado permanentemente.
            </span>
          </div>
          <Check checked={mantUser} onChange={setMantUser}
            label="Manter usuários e perfis de acesso"
            desc="Apenas o conteúdo (notícias, eventos, etc.) será removido." />
          <div style={{ marginBottom: SPACE.xl }}>
            <label style={labelSty}>Digite <strong style={{ color: C.subtle }}>CONFIRMAR_RESET</strong> para continuar</label>
            <input value={resetTxt} onChange={e => setResetTxt(e.target.value)} style={inputSty()} placeholder="CONFIRMAR_RESET" />
          </div>
          <button onClick={resetarBanco} disabled={loading === 'reset' || resetTxt !== 'CONFIRMAR_RESET'}
            style={btnSty('danger', loading === 'reset' || resetTxt !== 'CONFIRMAR_RESET')}>
            {loading === 'reset' ? <><Spin/> Resetando…</> : <>{Ico.trash} Resetar Banco</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL
═══════════════════════════════════════════════════════════════ */
export default function AdminSetup() {
  const cachedBoot = typeof window !== 'undefined' && window.__AL_SETUP_BOOT__ && (Date.now() - window.__AL_SETUP_BOOT__.at < 30000)
    ? window.__AL_SETUP_BOOT__
    : null
  const [bootStartedAt] = useState(() => performance.now())
  const [fase,   setFase]   = useState(() => cachedBoot?.status ? (cachedBoot.status.setup_needed ? 'instalar' : 'painel') : 'verificando')
  const [status, setStatus] = useState(() => cachedBoot?.status || null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (window.__AL_SETUP_CHUNK_STARTED__) {
      window.__AL_SETUP_TIMINGS__ = {
        ...(window.__AL_SETUP_TIMINGS__ || {}),
        setupChunkMs: performance.now() - window.__AL_SETUP_CHUNK_STARTED__,
      }
    }
    if (cachedBoot?.status) {
      window.__AL_SETUP_TIMINGS__ = { ...(window.__AL_SETUP_TIMINGS__ || {}), statusReuseMs: 0, firstGuardMs: cachedBoot.elapsed }
      return
    }
    const started = performance.now()
    setupService.status()
      .then(s => {
        const elapsed = performance.now() - started
        window.__AL_SETUP_TIMINGS__ = { ...(window.__AL_SETUP_TIMINGS__ || {}), adminSetupStatusMs: elapsed }
        setStatus(s); setFase(s.setup_needed ? 'instalar' : 'painel')
      })
      .catch(() => setFase('instalar'))
  }, [])

  if (fase === 'verificando') return <TelaVerificando startedAt={bootStartedAt}/>
  if (fase === 'painel')      return <PainelBanco status={status} onConcluido={res => { setResult(res); setFase('sucesso') }} />
  if (fase === 'sucesso')     return <TelaSucesso resultado={result} onIrPainel={() => { window.location.href = '/admin' }} />

  return <TelaInstalacao statusBanco={status} onSucesso={res => { setResult(res); setFase('sucesso') }} />
}
