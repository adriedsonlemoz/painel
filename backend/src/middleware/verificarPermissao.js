/**
 * Verificação centralizada de permissões + política MFA administrativa.
 * A Central de Segurança fica acessível mesmo quando o MFA obrigatório foi
 * habilitado, para que o próprio administrador consiga concluir o cadastro.
 */
import SecurityPolicy from '../models/SecurityPolicy.js'

let policyCache = { at: 0, value: null }
async function currentPolicy() {
  if (Date.now() - policyCache.at < 30_000 && policyCache.value) return policyCache.value
  const value = await SecurityPolicy.findOne({ chave:'default' }).select('mfa_admin_obrigatorio mfa_todos_obrigatorio').lean().catch(() => null)
  policyCache = { at:Date.now(), value:value || {} }
  return policyCache.value
}

export function verificarPermissao(permissao) {
  return async (req, res, next) => {
    try {
      const u = req.usuario
      if (!u) return res.status(401).json({ erro: 'Não autenticado.' })

      // Quando a política exige MFA, somente a própria Central de Segurança
      // permanece acessível para permitir o cadastro do autenticador.
      if (permissao !== 'seguranca.gerenciar' && !u.two_factor_enabled) {
        const policy = await currentPolicy()
        if (policy?.mfa_admin_obrigatorio || policy?.mfa_todos_obrigatorio) {
          return res.status(403).json({
            erro:'A política de segurança exige autenticação em dois fatores para acessar esta área.',
            codigo:'MFA_SETUP_REQUIRED',
            acao:'/admin/seguranca',
          })
        }
      }

      if (u.role === 'superadmin') return next()
      const perms = u.perfil_id?.permissoes || []
      if (perms.includes('*') || perms.includes(permissao)) return next()
      return res.status(403).json({ erro: 'Permissão insuficiente.' })
    } catch (error) { next(error) }
  }
}
