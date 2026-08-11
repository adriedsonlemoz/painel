import { Router } from 'express'
import { getPortalHomeContent, getWeather, getHoroscope, getFootball, getRssWorld } from '../services/portalContentService.js'

const router = Router()

router.get('/home', async (_req, res, next) => {
  try { res.json(await getPortalHomeContent()) } catch (e) { next(e) }
})
router.get('/weather', async (_req, res, next) => {
  try { res.json(await getWeather()) } catch (e) { next(e) }
})
router.get('/horoscope', async (req, res, next) => {
  try { res.json(await getHoroscope(req.query.sign)) } catch (e) { next(e) }
})
router.get('/football', async (_req, res, next) => {
  try { res.json(await getFootball()) } catch (e) { next(e) }
})
router.get('/rss-world', async (_req, res, next) => {
  try { res.json(await getRssWorld()) } catch (e) { next(e) }
})

export default router
