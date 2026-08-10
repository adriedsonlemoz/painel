/**
 * Usuários — AL Sistemas
 * CRUD completo de usuários e perfis de acesso ao painel admin.
 */
import { Router } from 'express'
import Usuario from '../models/Usuario.js'
import PerfilAcesso from '../models/PerfilAcesso.js'
import { autenticar } from '../middleware/auth.js'
import { verificarPermissao } from '../middleware/verificarPermissao.js'
import { auditLog } from '../middleware/auditLog.js'

const router = Router()
router.use(autenticar)

// Atalho: autenticar já rodou, basta checar permissão
const podeGerenciar = verificarPermissao('usuarios.gerenciar')

async function idsPerfisSuperadmin() {
  const perfis = await PerfilAcesso.find({ permissoes: '*' }).select('_id').lean()
  return perfis.map(p => p._id)
}

async function usuarioTemAcessoTotal(usuario) {
  if (!usuario) return false
  if (usuario.role === 'superadmin') return true
  if (!usuario.perfil_id) return false
  const perfil = await PerfilAcesso.findById(usuario.perfil_id).select('permissoes').lean()
  return Boolean(perfil?.permissoes?.includes('*'))
}

async function totalSuperadminsAtivos() {
  const perfilIds = await idsPerfisSuperadmin()
  return Usuario.countDocuments({
    ativo: true,
    $or: [
      { role: 'superadmin' },
      ...(perfilIds.length ? [{ perfil_id: { $in: perfilIds } }] : []),
    ],
  })
}

async function protegerUltimoSuperadmin(usuario, vaiPerderAcesso = true) {
  if (!vaiPerderAcesso) return false
  if (!(await usuarioTemAcessoTotal(usuario))) return false
  return (await totalSuperadminsAtivos()) <= 1
}

// ── GET /api/admin/usuarios — lista todos usuários
router.get('/', podeGerenciar, async (_req, res, next) => {
  try {
    const usuarios = await Usuario.find()
      .populate('perfil_id', 'nome cor permissoes')
      .sort({ criado_em: -1 })
      .lean()

    res.json({ usuarios: usuarios.map(u => { delete u.senha; return u }) })
  } catch (err) { next(err) }
})

// ── POST /api/admin/usuarios — cria novo usuário
router.post('/', podeGerenciar, auditLog('usuarios'), async (req, res, next) => {
  try {
    const { nome, email, senha, perfil_id, role } = req.body
    if (!nome?.trim() || !email?.trim() || !senha?.trim()) {
      return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios.' })
    }
    if (!validarForcaSenha(senha)) {
      return res.status(400).json({ erro: 'A senha deve ter pelo menos 8 caracteres, incluindo letras, números e um símbolo.' })
    }

    const existe = await Usuario.findOne({ email: email.trim().toLowerCase() })
    if (existe) return res.status(409).json({ erro: 'Este email já está em uso.' })

    let perfilDoc = null
    if (perfil_id) {
      perfilDoc = await PerfilAcesso.findById(perfil_id)
      if (!perfilDoc) return res.status(400).json({ erro: 'Perfil de acesso não encontrado.' })
    }

    const usuario = await Usuario.create({
      nome: nome.trim(),
      email: email.trim().toLowerCase(),
      senha,
      role: role === 'superadmin' && req.usuario.role === 'superadmin' ? 'superadmin' : 'admin',
      perfil_id: perfilDoc?._id || null,
      ativo: true,
    })

    const pop = await usuario.populate('perfil_id', 'nome cor')
    res.status(201).json({ usuario: pop })
  } catch (err) { next(err) }
})

// ── GET /api/admin/usuarios/:id — detalhe de um usuário
router.get('/:id', podeGerenciar, async (req, res, next) => {
  try {
    const usuario = await Usuario.findById(req.params.id)
      .populate('perfil_id', 'nome cor permissoes')
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' })
    res.json({ usuario })
  } catch (err) { next(err) }
})

// ── PUT /api/admin/usuarios/:id — atualiza usuário
router.put('/:id', podeGerenciar, auditLog('usuarios'), async (req, res, next) => {
  try {
    const { nome, email, senha, perfil_id, role, ativo } = req.body
    const usuario = await Usuario.findById(req.params.id)
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' })

    // Não permite desativar o próprio usuário
    if (req.usuario._id.toString() === req.params.id && ativo === false) {
      return res.status(400).json({ erro: 'Você não pode desativar sua própria conta.' })
    }

    let novoPerfil = null
    if (perfil_id) {
      novoPerfil = await PerfilAcesso.findById(perfil_id)
      if (!novoPerfil) return res.status(400).json({ erro: 'Perfil de acesso não encontrado.' })
    }

    const perfilMudando = perfil_id !== undefined && String(usuario.perfil_id || '') !== String(perfil_id || '')
    const perfilEfetivo = perfil_id !== undefined
      ? novoPerfil
      : (usuario.perfil_id ? await PerfilAcesso.findById(usuario.perfil_id).select('permissoes').lean() : null)
    const roleEfetiva = (role && req.usuario.role === 'superadmin') ? role : usuario.role
    const novoTemAcessoTotal = roleEfetiva === 'superadmin' || Boolean(perfilEfetivo?.permissoes?.includes('*'))
    const vaiPerderAcessoTotal = ativo === false || (perfilMudando && !novoTemAcessoTotal) || (role && roleEfetiva !== 'superadmin' && !novoTemAcessoTotal)
    if (await protegerUltimoSuperadmin(usuario, vaiPerderAcessoTotal)) {
      return res.status(409).json({ erro: 'Este é o último superadministrador ativo. Crie ou promova outro superadministrador antes desta alteração.' })
    }

    if (nome)  usuario.nome  = nome.trim()
    if (email) {
      const normalizado = email.trim().toLowerCase()
      const existe = await Usuario.findOne({ email: normalizado, _id: { $ne: usuario._id } }).select('_id').lean()
      if (existe) return res.status(409).json({ erro: 'Este email já está em uso.' })
      usuario.email = normalizado
    }
    if (senha) {
      if (!validarForcaSenha(senha)) {
        return res.status(400).json({ erro: 'A senha deve ter pelo menos 8 caracteres, incluindo letras, números e um símbolo.' })
      }
      usuario.senha = senha
      usuario.sessao_versao = (usuario.sessao_versao || 0) + 1
    }
    // role é legado: só superadmin pode promover outro usuário por esta via.
    if (role && req.usuario.role === 'superadmin') usuario.role = role
    if (perfil_id !== undefined) usuario.perfil_id = perfil_id || null
    if (ativo !== undefined) {
      if (usuario.ativo !== ativo) usuario.sessao_versao = (usuario.sessao_versao || 0) + 1
      usuario.ativo = ativo
    }

    await usuario.save()
    const pop = await usuario.populate('perfil_id', 'nome cor permissoes')
    res.json({ usuario: pop })
  } catch (err) { next(err) }
})

// ── POST /api/admin/usuarios/:id/desbloquear — limpa bloqueio de login
router.post('/:id/desbloquear', podeGerenciar, auditLog('usuarios'), async (req, res, next) => {
  try {
    const usuario = await Usuario.findById(req.params.id)
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' })
    usuario.tentativas_login = 0
    usuario.bloqueado_ate = null
    await usuario.save()
    const pop = await usuario.populate('perfil_id', 'nome cor permissoes')
    res.json({ usuario: pop, mensagem: 'Usuário desbloqueado.' })
  } catch (err) { next(err) }
})

// ── POST /api/admin/usuarios/:id/revogar-sessoes — encerra tokens atuais
router.post('/:id/revogar-sessoes', podeGerenciar, auditLog('usuarios'), async (req, res, next) => {
  try {
    const usuario = await Usuario.findById(req.params.id)
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' })
    if (req.usuario._id.toString() === req.params.id) {
      return res.status(400).json({ erro: 'Use Sair para encerrar sua própria sessão. Esta ação é destinada a outras contas.' })
    }
    usuario.sessao_versao = (usuario.sessao_versao || 0) + 1
    await usuario.save()
    res.json({ mensagem: 'Sessões revogadas. O usuário precisará entrar novamente.' })
  } catch (err) { next(err) }
})

// ── DELETE /api/admin/usuarios/:id — exclui usuário
router.delete('/:id', podeGerenciar, auditLog('usuarios'), async (req, res, next) => {
  try {
    if (req.usuario._id.toString() === req.params.id) {
      return res.status(400).json({ erro: 'Você não pode excluir sua própria conta.' })
    }
    const usuario = await Usuario.findById(req.params.id)
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' })
    if (await protegerUltimoSuperadmin(usuario, usuario.ativo !== false)) {
      return res.status(409).json({ erro: 'O último superadministrador ativo não pode ser excluído.' })
    }
    await usuario.deleteOne()
    res.json({ mensagem: 'Usuário excluído com sucesso.' })
  } catch (err) { next(err) }
})

// ─────────────────────────────────────────────────────────────
// PERFIS DE ACESSO
// ─────────────────────────────────────────────────────────────

router.get('/perfis/todos', podeGerenciar, async (_req, res, next) => {
  try {
    const perfis = await PerfilAcesso.find().sort({ sistema: -1, nome: 1 })
    res.json({ perfis })
  } catch (err) { next(err) }
})

router.post('/perfis/novo', podeGerenciar, auditLog('perfis_acesso'), async (req, res, next) => {
  try {
    const { nome, descricao, permissoes, cor } = req.body
    if (!nome?.trim()) return res.status(400).json({ erro: 'Nome do perfil é obrigatório.' })

    const existe = await PerfilAcesso.findOne({ nome: nome.trim() })
    if (existe) return res.status(409).json({ erro: 'Já existe um perfil com este nome.' })

    const perfil = await PerfilAcesso.create({
      nome: nome.trim(),
      descricao: descricao?.trim() || '',
      permissoes: permissoes || [],
      cor: cor || '#6366f1',
      sistema: false,
    })
    res.status(201).json({ perfil })
  } catch (err) { next(err) }
})

router.put('/perfis/:id', podeGerenciar, auditLog('perfis_acesso'), async (req, res, next) => {
  try {
    const perfil = await PerfilAcesso.findById(req.params.id)
    if (!perfil) return res.status(404).json({ erro: 'Perfil não encontrado.' })

    const { nome, descricao, permissoes, cor } = req.body

    if (!perfil.sistema) {
      if (nome)        perfil.nome = nome.trim()
      if (permissoes)  perfil.permissoes = permissoes
    }
    if (descricao !== undefined) perfil.descricao = descricao.trim()
    if (cor)           perfil.cor = cor

    await perfil.save()
    res.json({ perfil })
  } catch (err) { next(err) }
})

router.delete('/perfis/:id', podeGerenciar, auditLog('perfis_acesso'), async (req, res, next) => {
  try {
    const perfil = await PerfilAcesso.findById(req.params.id)
    if (!perfil) return res.status(404).json({ erro: 'Perfil não encontrado.' })
    if (perfil.sistema) return res.status(400).json({ erro: 'Perfis do sistema não podem ser excluídos.' })

    const emUso = await Usuario.countDocuments({ perfil_id: req.params.id })
    if (emUso > 0) {
      return res.status(409).json({
        erro: `Este perfil está vinculado a ${emUso} usuário(s). Remova o vínculo antes de excluir.`,
      })
    }

    await PerfilAcesso.findByIdAndDelete(req.params.id)
    res.json({ mensagem: 'Perfil excluído.' })
  } catch (err) { next(err) }
})

// ── Validação de força de senha ───────────────────────────────────────────────
// Mínimo 8 chars, pelo menos 1 letra, 1 número e 1 símbolo
export function validarForcaSenha(senha) {
  if (!senha || senha.length < 8) return false
  if (!/[a-zA-Z]/.test(senha))    return false
  if (!/[0-9]/.test(senha))       return false
  if (!/[^a-zA-Z0-9]/.test(senha)) return false
  return true
}

export default router
