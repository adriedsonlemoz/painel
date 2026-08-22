/**
 * Tema: Claro (Padrão)
 * Paleta inspirada no layout do print — fundo bege/areia suave, verde oliva.
 */
const lightTheme = {
  id: 'light',
  nome: 'Claro',
  descricao: 'Fundo neutro claro com acentos em verde oliva.',
  icone: '☀️',
  vars: {
    '--adm-bg':        '#f0ede8',
    '--adm-surface':   '#ffffff',
    '--adm-surface2':  '#f7f5f2',
    '--adm-border':    '#e8e3dc',
    '--adm-border2':   '#d4cec6',
    '--adm-text':      '#1c1c1e',
    '--adm-subtle':   '#94a3b8',
    '--adm-muted':     '#625d58',
    '--adm-accent':    '#6b7c4e',
    '--adm-accent-d':  '#4a5c34',
    '--adm-accent-rgb':'107,124,78',
    '--adm-red':       '#dc2626',
    '--adm-amber':     '#d97706',
    '--adm-blue':      '#2563eb',
    '--adm-warning':   'var(--adm-amber)',
    '--adm-danger':    'var(--adm-red)',
    '--adm-success':   '#16a34a',
    '--adm-topnav-bg': '#ffffff',
    '--adm-overlay':   'rgba(15,23,42,.46)',
    '--adm-shadow':    '0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04)',
    '--adm-shadow-md': '0 4px 12px rgba(0,0,0,.08)',
  },
}

export default lightTheme
