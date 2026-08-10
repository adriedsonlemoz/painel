import { T as C, RADIUS, FONT } from '../../../themes/tokens'
import AdminIcon from '../ui/AdminIcon'

export default function ConfigIntegracoes(){
 return <section style={{marginBottom:20,border:`1px solid ${C.border}`,borderRadius:RADIUS.xl,background:C.surface,padding:18}}>
  <div style={{display:'flex',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
   <span style={{color:C.accent}}><AdminIcon name="shield" size={20}/></span>
   <div style={{flex:'1 1 260px'}}>
    <h3 style={{margin:0,color:C.text,fontSize:15}}>Integrações centralizadas</h3>
    <p style={{margin:'5px 0 12px',color:C.muted,fontSize:FONT.sm,lineHeight:1.55}}>As APIs não são mais configuradas nesta tela. GitHub, Render, Vercel, Cloudflare, Cloudinary, Gemini e OpenRouter ficam em um único lugar para evitar credenciais duplicadas.</p>
    <a href="/admin/integracoes" style={{display:'inline-flex',padding:'8px 12px',borderRadius:RADIUS.md,background:C.accent,color:'#fff',fontWeight:700,textDecoration:'none'}}>Abrir Integrações e APIs</a>
   </div>
  </div>
 </section>
}
