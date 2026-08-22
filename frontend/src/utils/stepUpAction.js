/**
 * Confirmação reforçada assíncrona sem diálogos nativos do navegador.
 * Retorna { senha, codigo } ou null quando o usuário cancela.
 */
export function stepUpAction({ title = 'Confirme sua identidade', message = 'Esta ação é sensível. Digite sua senha atual e, se sua conta usar 2FA, o código do autenticador.' } = {}) {
  if (typeof document === 'undefined') return Promise.resolve(null)
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'al-stepup-overlay'
    overlay.innerHTML = `
      <form class="al-stepup-dialog" role="dialog" aria-modal="true" aria-labelledby="al-stepup-title">
        <div class="al-stepup-kicker">SEGURANÇA</div>
        <h2 id="al-stepup-title"></h2>
        <p class="al-stepup-message"></p>
        <label class="al-stepup-field"><span>Senha atual</span><input name="senha" type="password" autocomplete="current-password" required /></label>
        <label class="al-stepup-field"><span>Código 2FA <small>(se ativo)</small></span><input name="codigo" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="000000" /></label>
        <div class="al-stepup-error" aria-live="polite"></div>
        <div class="al-stepup-actions"><button type="button" data-action="cancel">Cancelar</button><button type="submit" class="primary">Confirmar</button></div>
      </form>`
    overlay.querySelector('#al-stepup-title').textContent = title
    overlay.querySelector('.al-stepup-message').textContent = message
    const style = document.createElement('style')
    style.textContent = `.al-stepup-overlay{position:fixed;inset:0;z-index:100001;display:grid;place-items:center;padding:16px;background:rgba(15,23,42,.62);backdrop-filter:blur(5px)}.al-stepup-dialog{width:min(430px,100%);box-sizing:border-box;padding:20px;border:1px solid var(--adm-border,#d8d4cd);border-radius:18px;background:var(--adm-surface,#fff);color:var(--adm-text,#1c1c1e);box-shadow:0 26px 75px rgba(0,0,0,.3)}.al-stepup-kicker{color:var(--adm-accent,#6b7c4e);font-size:11px;font-weight:900;letter-spacing:.14em}.al-stepup-dialog h2{margin:7px 0 7px;font-size:20px;line-height:1.2}.al-stepup-message{margin:0 0 16px;color:var(--adm-muted,#625d57);font-size:13px;line-height:1.55}.al-stepup-field{display:grid;gap:6px;margin-top:11px}.al-stepup-field span{font-size:12px;font-weight:800}.al-stepup-field small{font-weight:600;color:var(--adm-muted,#625d57)}.al-stepup-field input{width:100%;min-height:46px;box-sizing:border-box;border:1px solid var(--adm-border,#d8d4cd);border-radius:10px;background:var(--adm-surface2,#f7f5f2);color:var(--adm-text,#1c1c1e);font-size:15px;padding:10px 12px;outline:none}.al-stepup-field input:focus{border-color:var(--adm-accent,#6b7c4e);box-shadow:0 0 0 3px color-mix(in srgb,var(--adm-accent,#6b7c4e) 15%,transparent)}.al-stepup-error{min-height:18px;margin-top:8px;color:var(--adm-red,#dc2626);font-size:12px}.al-stepup-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:4px}.al-stepup-actions button{min-height:46px;border:1px solid var(--adm-border,#d8d4cd);border-radius:10px;background:var(--adm-surface2,#f7f5f2);color:inherit;font-size:13px;font-weight:850;padding:10px 12px;cursor:pointer}.al-stepup-actions .primary{background:var(--adm-accent,#6b7c4e);border-color:var(--adm-accent,#6b7c4e);color:#fff}@media(max-width:420px){.al-stepup-dialog{padding:17px}.al-stepup-actions{grid-template-columns:1fr}.al-stepup-actions .primary{order:-1}}`
    document.head.appendChild(style)
    document.body.appendChild(overlay)
    const form = overlay.querySelector('form')
    const senha = overlay.querySelector('[name="senha"]')
    const codigo = overlay.querySelector('[name="codigo"]')
    const error = overlay.querySelector('.al-stepup-error')
    let closed = false
    const done = value => {
      if (closed) return
      closed = true
      document.removeEventListener('keydown', onKey)
      overlay.remove(); style.remove(); resolve(value)
    }
    const onKey = e => { if (e.key === 'Escape') done(null) }
    document.addEventListener('keydown', onKey)
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) done(null) })
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => done(null))
    form.addEventListener('submit', e => {
      e.preventDefault()
      const password = String(senha.value || '')
      if (!password) { error.textContent = 'Digite sua senha atual.'; senha.focus(); return }
      done({ senha: password, codigo: String(codigo.value || '').trim() })
    })
    setTimeout(() => senha.focus(), 0)
  })
}
