import { useState, useEffect, useCallback } from 'react'
import { rssService, categoriasService, fontesService } from '../services/api'
import toast from 'react-hot-toast'

export function useRss() {
  const [fontes, setFontes] = useState([])
  const [padrao, setPadrao] = useState([])
  const [categorias, setCategorias] = useState([])
  const [fontesEditoriais, setFontesEditoriais] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [importando, setImportando] = useState(null)
  const [importandoTodas, setImportandoTodas] = useState(false)
  const [reprocessando, setReprocessando] = useState(false)
  const [resultados, setResultados] = useState(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const [feeds, sugeridos, cats, origens] = await Promise.all([
        rssService.listarFontes(), rssService.fontesPadrao(), categoriasService.listar(), fontesService.listar(),
      ])
      setFontes(Array.isArray(feeds) ? feeds : (feeds.fontes || []))
      setPadrao(Array.isArray(sugeridos) ? sugeridos : [])
      setCategorias(Array.isArray(cats) ? cats : (cats.categorias || []))
      setFontesEditoriais(Array.isArray(origens) ? origens : (origens.fontes || []))
    } catch (err) {
      toast.error('Erro ao carregar RSS: ' + err.message)
    } finally { setCarregando(false) }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function salvarFonte(dados, id) {
    const out = id ? await rssService.editarFonte(id, dados) : await rssService.criarFonte(dados)
    toast.success(id ? 'Feed atualizado!' : 'Feed cadastrado!')
    await carregar()
    return out
  }

  async function criarFonteEditorial(dados) {
    const out = await fontesService.criar(dados)
    toast.success('Fonte editorial criada')
    await carregar()
    return out
  }

  async function criarCategoria(dados) {
    const out = await categoriasService.criar(dados)
    toast.success('Categoria criada')
    await carregar()
    return out
  }

  async function excluirFonte(fonte) {
    try {
      await rssService.excluirFonte(fonte.id)
      toast.success('Feed removido; notícias importadas foram preservadas')
      await carregar()
    } catch (err) { toast.error(err.message || 'Erro ao excluir feed') }
  }

  async function importarFonte(fonte) {
    setImportando(fonte.id); setResultados(null)
    try {
      const r = await rssService.importarFonte(fonte.id)
      setResultados(r)
      toast.success(`${r.importadas || 0} notícia(s) importada(s)` + (r.ia_em_background ? ' · IA em processamento' : ''))
      await carregar()
    } catch (err) { toast.error('Erro na importação: ' + err.message) }
    finally { setImportando(null) }
  }

  async function importarTodas() {
    setImportandoTodas(true); setResultados(null)
    try {
      const r = await rssService.importarTodas()
      setResultados(r)
      toast.success(`${r.totalImportadas ?? 0} nova(s) · ${r.totalDuplicadas ?? 0} duplicada(s)`)
      await carregar()
    } catch (err) { toast.error('Erro na importação: ' + err.message) }
    finally { setImportandoTodas(false) }
  }

  async function reprocessarImportadas() {
    setReprocessando(true)
    try {
      const r = await rssService.reprocessarImportadas()
      toast.success(`${r.atualizadas ?? 0} notícia(s) corrigida(s)`)
      return r
    } catch (err) { toast.error('Erro ao reprocessar RSS: ' + err.message) }
    finally { setReprocessando(false) }
  }

  return {
    fontes, padrao, categorias, fontesEditoriais,
    carregando, importando, importandoTodas, reprocessando, resultados, setResultados,
    temFontesAtivas: fontes.some(f => f.ativa),
    carregar, salvarFonte, criarFonteEditorial, criarCategoria, excluirFonte, importarFonte, importarTodas, reprocessarImportadas,
  }
}
