/** Confirmação assíncrona do painel sem window.confirm(). */
export function confirmAction(message, { title='Confirmar ação', confirmLabel='Confirmar', danger=true } = {}) {
  return new Promise(resolve => {
    const overlay=document.createElement('div')
    overlay.className='al-confirm-overlay'
    overlay.innerHTML=`<div class="al-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="al-confirm-title"><div class="al-confirm-head"><b id="al-confirm-title"></b></div><p></p><div class="al-confirm-actions"><button type="button" data-action="cancel">Cancelar</button><button type="button" data-action="confirm" class="${danger?'danger':'primary'}"></button></div></div>`
    overlay.querySelector('b').textContent=title
    overlay.querySelector('p').textContent=String(message||'Tem certeza que deseja continuar?')
    overlay.querySelector('[data-action="confirm"]').textContent=confirmLabel
    const style=document.createElement('style'); style.textContent=`.al-confirm-overlay{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.58);backdrop-filter:blur(4px)}.al-confirm-dialog{width:min(430px,100%);box-sizing:border-box;padding:16px;border:1px solid var(--adm-border,#334155);border-radius:16px;background:var(--adm-surface,#111827);color:var(--adm-text,#f8fafc);box-shadow:0 24px 70px rgba(0,0,0,.35)}.al-confirm-head b{font-size:16px}.al-confirm-dialog p{margin:10px 0 16px;color:var(--adm-muted,#94a3b8);font-size:13px;line-height:1.5;overflow-wrap:anywhere}.al-confirm-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.al-confirm-actions button{min-width:0;padding:10px;border:1px solid var(--adm-border,#334155);border-radius:9px;background:var(--adm-surface2,#1f2937);color:inherit;font-weight:800}.al-confirm-actions .danger{color:var(--adm-red,#ef4444)}.al-confirm-actions .primary{background:var(--adm-accent,#2563eb);color:#fff}`
    document.head.appendChild(style); document.body.appendChild(overlay)
    const done=value=>{document.removeEventListener('keydown',key);overlay.remove();style.remove();resolve(value)}
    const key=e=>{if(e.key==='Escape')done(false)};document.addEventListener('keydown',key)
    overlay.addEventListener('click',e=>{if(e.target===overlay||e.target.closest('[data-action="cancel"]'))done(false);else if(e.target.closest('[data-action="confirm"]'))done(true)})
    overlay.querySelector('[data-action="cancel"]').focus()
  })
}
