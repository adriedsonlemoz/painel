/**
 * 1.0.117 — Integração do módulo Conteúdo.
 * Garante a categoria "Geral" e classifica notícias antigas que ainda não
 * possuíam categoria. Novas notícias passam a exigir categoria na API.
 */
module.exports = {
  async up(db) {
    const categorias = db.collection('categorias')
    const noticias = db.collection('noticias')

    await categorias.updateOne(
      { slug: 'geral' },
      { $setOnInsert: {
        nome: 'Geral',
        slug: 'geral',
        cor: '#607D8B',
        descricao: 'Notícias gerais do portal.',
        criado_em: new Date(),
        updatedAt: new Date(),
      } },
      { upsert: true }
    )

    const geral = await categorias.findOne({ slug: 'geral' })
    if (!geral?._id) throw new Error('Não foi possível preparar a categoria Geral.')

    const result = await noticias.updateMany(
      { $or: [
        { categoria_id: { $exists: false } },
        { categoria_id: null },
      ] },
      { $set: { categoria_id: geral._id } }
    )

    console.log(`✅ Categoria obrigatória preparada; ${result.modifiedCount || 0} notícia(s) antiga(s) movida(s) para Geral`)
  },

  // Não removemos categorias no rollback para evitar transformar notícias
  // válidas novamente em documentos sem classificação.
  down: async function () {
    console.log('ℹ️ Rollback não destrutivo: categorias das notícias foram preservadas')
  },
}
