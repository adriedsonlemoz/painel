/**
 * 1.0.118 — RSS passa a usar Fonte e Categoria do módulo Conteúdo.
 * Backfill não destrutivo para instalações existentes.
 */
module.exports = {
  async up(db) {
    const rss = db.collection('rssfontes')
    const fontes = db.collection('fontes')
    const categorias = db.collection('categorias')
    const noticias = db.collection('noticias')

    await categorias.updateOne(
      { slug: 'geral' },
      { $setOnInsert: { nome: 'Geral', slug: 'geral', cor: '#607D8B', descricao: 'Notícias gerais do portal.', criado_em: new Date(), atualizado_em: new Date() } },
      { upsert: true }
    )
    const geral = await categorias.findOne({ slug: 'geral' })
    if (!geral?._id) throw new Error('Categoria Geral não pôde ser preparada.')

    const feeds = await rss.find({}).toArray()
    let associados = 0
    let reclassificados = 0
    let noticiasReassociadas = 0

    for (const feed of feeds) {
      let categoriaId = feed.categoria_id
      if (!categoriaId) {
        categoriaId = geral._id
        reclassificados++
      }

      let fonteId = feed.fonte_id
      let fonteDoc = fonteId ? await fontes.findOne({ _id: fonteId }) : null
      if (!fonteDoc) {
        const baseNome = String(feed.nome || 'Fonte RSS').split(/\s+[—–-]\s+/)[0].trim() || 'Fonte RSS'
        fonteDoc = await fontes.findOne({ nome: { $regex: `^${baseNome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } })
        if (!fonteDoc) {
          let home = null
          try { const u = new URL(String(feed.url || '')); home = `${u.protocol}//${u.host}` } catch {}
          const insert = await fontes.insertOne({ nome: baseNome, url: home, criado_em: new Date() })
          fonteDoc = { _id: insert.insertedId, nome: baseNome, url: home }
        }
        fonteId = fonteDoc._id
        associados++
      }

      await rss.updateOne({ _id: feed._id }, { $set: { fonte_id: fonteId, categoria_id: categoriaId, copiar_imagem_r2: feed.copiar_imagem_r2 !== false } })
      const news = await noticias.updateMany({ rss_fonte_id: feed._id }, { $set: { fonte_id: fonteId, categoria_id: categoriaId } })
      noticiasReassociadas += Number(news.modifiedCount || 0)

      // Remove apenas a Fonte antiga criada automaticamente com o nome completo do feed
      // quando ela ficou realmente sem uso após a consolidação.
      if (feed.nome && String(feed.nome).trim().toLowerCase() !== String(fonteDoc.nome || '').trim().toLowerCase()) {
        const old = await fontes.findOne({ nome: feed.nome })
        if (old && String(old._id) !== String(fonteId)) {
          const [newsCount, feedCount] = await Promise.all([
            noticias.countDocuments({ fonte_id: old._id }),
            rss.countDocuments({ fonte_id: old._id }),
          ])
          if (!newsCount && !feedCount) await fontes.deleteOne({ _id: old._id })
        }
      }
    }

    await rss.createIndex({ fonte_id: 1 })
    await rss.createIndex({ categoria_id: 1 })
    console.log(`✅ RSS integrado ao Conteúdo: ${associados} feed(s) associados, ${reclassificados} categoria(s) corrigida(s), ${noticiasReassociadas} notícia(s) normalizada(s).`)
  },

  down: async function () {
    console.log('ℹ️ Rollback não destrutivo: vínculos de Fonte/Categoria do RSS foram preservados.')
  },
}
