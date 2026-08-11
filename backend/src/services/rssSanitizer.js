/**
 * rssSanitizer.js — v2.2
 * Sanitização e limpeza editorial de conteúdo vindo de RSS/Atom.
 *
 * Além de bloquear HTML inseguro, remove lixo comum de feeds (slots de
 * publicidade, trackers e blocos "Leia mais/Veja também") para que o portal
 * não replique elementos do site de origem dentro da matéria importada.
 */
import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = [
  'h2','h3','h4','h5','h6','p','br','hr','span',
  'strong','em','b','i','u','s','del','mark','sub','sup',
  'blockquote','pre','code','ul','ol','li','a','img','picture','source',
  'figure','figcaption','div','section','article',
  'table','thead','tbody','tfoot','tr','th','td','caption',
]

const ALLOWED_ATTRS = {
  a:['href','title','rel','target'],
  img:['src','alt','title','width','height','loading','decoding'],
  source:['srcset','type','media'], picture:[],
  td:['colspan','rowspan','align'], th:['colspan','rowspan','align','scope'],
  table:['border','cellpadding','cellspacing'],
  code:['class'], pre:['class'], span:['class'], div:['class','id'], section:['class','id'], article:['class','id'],
  blockquote:['cite'],
}

const SANITIZE_OPTIONS = {
  allowedTags:ALLOWED_TAGS,
  allowedAttributes:ALLOWED_ATTRS,
  allowedSchemes:['http','https','mailto'],
  allowedSchemesByTag:{img:['http','https'],source:['http','https']},
  allowedSchemesAppliedToAttributes:['href','src','srcset'],
  nonTextTags:['script','style','noscript','template','textarea','option','head','title','iframe','object','embed'],
  disallowedTagsMode:'discard',
  transformTags:{
    a:(_tag,attribs)=>{
      const href=attribs.href||''
      const isExternal=/^https?:\/\//i.test(href)
      return {tagName:'a',attribs:{href,...(attribs.title&&{title:attribs.title}),rel:'noopener noreferrer',...(isExternal&&{target:'_blank'})}}
    },
    img:(_tag,attribs)=>{
      const src=attribs.src||''
      if(src.startsWith('data:')||src.startsWith('blob:'))return {tagName:'span',attribs:{}}
      return {tagName:'img',attribs:{src,alt:attribs.alt||'',loading:attribs.loading||'lazy',decoding:'async',...(attribs.width&&{width:attribs.width}),...(attribs.height&&{height:attribs.height})}}
    },
    h1:()=>({tagName:'h2',attribs:{}}),
  },
}

const NOISE_CLASS_RE = /(?:^|[-_\s])(?:ad|ads|advert|advertisement|publicidade|banner(?:[-_]?ad)?|custom[-_\s]*ad[-_\s]*element|ad[-_]?(?:slot|unit|container|wrapper)|promo|sponsored|tracking)(?:$|[-_\s])/i
const RELATED_HEADING_RE = /^\s*(?:leia\s+(?:mais|tamb[eé]m)|veja\s+(?:mais|tamb[eé]m)|relacionad[oa]s?|conte[uú]do\s+relacionado|mais\s+sobre|recomendad[oa]s?)\s*:?[\s.!]*$/i

function stripNoiseContainers(html=''){
  let out=String(html||'')
  // O HTML já foi sanitizado: aqui só retiramos wrappers editoriais conhecidos.
  for(let pass=0;pass<4;pass++){
    const before=out
    out=out.replace(/<(div|section|article)\b([^>]*)>[\s\S]*?<\/\1>/gi,(full,_tag,attrs)=>{
      const marker=[...String(attrs).matchAll(/(?:class|id)=["']([^"']*)["']/gi)].map(m=>m[1]).join(' ')
      return NOISE_CLASS_RE.test(marker)?'':full
    })
    if(out===before)break
  }
  return out
}

function stripRelatedBlocks(html=''){
  let out=String(html||'')
  // Remove cabeçalho editorial e, quando imediatamente presente, a lista/bloco de links que o acompanha.
  out=out.replace(/<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>\s*(<(?:ul|ol|div|section)\b[^>]*>[\s\S]*?<\/(?:ul|ol|div|section)>\s*)?/gi,(full,_level,inner)=>{
    const heading=sanitizeHtml(inner,{allowedTags:[],allowedAttributes:{}}).replace(/\s+/g,' ').trim()
    return RELATED_HEADING_RE.test(heading)?'':full
  })
  return out
}

function stripEmptyWrappers(html=''){
  let out=String(html||'')
  for(let i=0;i<3;i++){
    const next=out
      .replace(/<(?:div|section|article|p|span)\b[^>]*>\s*(?:&nbsp;|<br\s*\/?\s*>|\s)*<\/(?:div|section|article|p|span)>/gi,'')
      .replace(/(?:<br\s*\/?\s*>\s*){3,}/gi,'<br><br>')
    if(next===out)break
    out=next
  }
  return out.trim()
}

export function sanitizeContent(html=''){
  if(!html?.trim())return ''
  const safe=sanitizeHtml(html,SANITIZE_OPTIONS)
  return stripEmptyWrappers(stripRelatedBlocks(stripNoiseContainers(safe)))
}

export function htmlToText(html=''){
  if(!html?.trim())return ''
  return sanitizeHtml(html,{allowedTags:[],allowedAttributes:{},nonTextTags:['script','style','noscript','template','textarea','option','iframe','object','embed']})
    .replace(/&nbsp;/gi,' ')
    .replace(/\s+/g,' ')
    .trim()
}

export function makeExcerpt(html='',maxLen=300){
  const text=htmlToText(html)
  if(!text)return ''
  if(text.length<=maxLen)return text
  const cut=text.substring(0,maxLen)
  const lastSpace=cut.lastIndexOf(' ')
  return (lastSpace>0?cut.substring(0,lastSpace):cut)+'…'
}

export function extractFirstImage(html=''){
  if(!html)return null
  const match=html.match(/<img[^>]+src=["']([^"']+)["']/i)
  if(!match)return null
  const src=match[1]
  return src.startsWith('data:')||src.startsWith('blob:')?null:src
}
