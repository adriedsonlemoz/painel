import { AlertTriangle } from 'lucide-react'
import { DSModal, DSBtn } from './admin/ui/DS'
import { T, FONT, SPACE, RADIUS } from '../themes/tokens'

/**
 * Confirmação global do painel.
 * Usa o mesmo DSModal dos demais fluxos para respeitar tema, centralização e mobile.
 */
export default function ConfirmModal({
  aberto,
  titulo = 'Confirmar ação',
  mensagem = 'Tem certeza que deseja continuar?',
  labelConfirmar = 'Confirmar',
  carregando = false,
  onConfirmar,
  onCancelar,
  variante = 'danger',
}) {
  const warning = variante === 'warning'
  const tone = warning ? T.amber : T.red

  return (
    <DSModal
      open={aberto}
      onClose={onCancelar}
      title={titulo}
      size="sm"
      footer={
        <>
          <DSBtn variant={warning ? 'secondary' : 'danger'} loading={carregando} onClick={onConfirmar} style={warning ? { color:T.amber, borderColor:`color-mix(in srgb,${T.amber} 30%,transparent)` } : undefined}>
            {labelConfirmar}
          </DSBtn>
          <DSBtn onClick={onCancelar} disabled={carregando}>Cancelar</DSBtn>
        </>
      }
    >
      <div style={{ display:'flex', alignItems:'flex-start', gap:SPACE.lg }}>
        <div style={{ width:38, height:38, borderRadius:RADIUS.lg, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', color:tone, background:`color-mix(in srgb,${tone} 10%,transparent)`, border:`1px solid color-mix(in srgb,${tone} 24%,transparent)` }}>
          <AlertTriangle size={18} />
        </div>
        <p style={{ margin:0, color:T.muted, fontSize:FONT.md, lineHeight:1.55 }}>{mensagem}</p>
      </div>
    </DSModal>
  )
}
