/**
 * GitHubMeta.js — Metadados Internos de Repositórios GitHub
 *
 * Sprint 3 EXTENSÃO — ADIÇÃO PURA.
 *
 * Armazena informações internas sobre repos GitHub.
 * NUNCA altera dados no GitHub — apenas metadados locais do AL Sistemas.
 */
import mongoose from 'mongoose'

const gitHubMetaSchema = new mongoose.Schema({
  // Identificação do repo no GitHub
  repoId:       { type: Number, required: true, unique: true },  // GitHub repo ID
  nomeCompleto: { type: String, required: true },                 // owner/repo

  // Metadados internos
  alias:        { type: String, default: null },
  tags:         { type: [String], default: [] },
  favorito:     { type: Boolean, default: false },
  statusInterno: {
    type: String,
    enum: ['ativo', 'arquivado', 'estudo', 'legado'],
    default: 'ativo',
  },
  observacoes:  { type: String, default: null },

  // Vinculação com projeto local (legado/VPS; não é requisito para o módulo GitHub)
  projetoLocal: { type: String, default: null },  // nome da pasta em /projetos

  // Preferências de publicação GitHub/cloud. O GitHub é o destino principal;
  // Vercel/Render são detectados posteriormente pela integração central.
  publicacao: {
    repository: { type: String, default: null },
    branch:     { type: String, default: 'main' },
    path:       { type: String, default: '' },
    snapshotR2: { type: Boolean, default: false },
  },

}, {
  timestamps: { createdAt: 'criado_em', updatedAt: 'atualizado_em' },
})

gitHubMetaSchema.index({ favorito: 1 })
gitHubMetaSchema.index({ statusInterno: 1 })

export default mongoose.model('GitHubMeta', gitHubMetaSchema)
