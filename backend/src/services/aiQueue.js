const PRIORITY_WEIGHT = { urgent: 0, high: 1, normal: 2, low: 3, background: 4 }
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.AI_CONCURRENCY || 2)))
const MAX_QUEUE = Math.max(10, Math.min(500, Number(process.env.AI_MAX_QUEUE || 100)))

let active = 0
let sequence = 0
const queue = []

function sortQueue() {
  queue.sort((a, b) => (PRIORITY_WEIGHT[a.priority] ?? 2) - (PRIORITY_WEIGHT[b.priority] ?? 2) || a.sequence - b.sequence)
}

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const item = queue.shift()
    if (item.signal?.aborted) {
      item.reject(Object.assign(new Error('Operação de IA cancelada antes de iniciar.'), { code: 'AI_ABORTED', status: 499 }))
      continue
    }
    if(item.abortHandler&&item.signal)item.signal.removeEventListener('abort',item.abortHandler)
    active++
    item.startedAt = Date.now()
    Promise.resolve()
      .then(() => item.fn({ queueWaitMs: item.startedAt - item.enqueuedAt }))
      .then(item.resolve, item.reject)
      .finally(() => { active--; pump() })
  }
}

export function runAiQueued(fn, { priority = 'normal', signal } = {}) {
  if (queue.length >= MAX_QUEUE) {
    const err = new Error('Fila de IA cheia. Aguarde alguns instantes e tente novamente.')
    err.code = 'AI_QUEUE_FULL'; err.status = 503
    return Promise.reject(err)
  }
  return new Promise((resolve, reject) => {
    const item={ fn, resolve, reject, signal, priority, sequence: ++sequence, enqueuedAt: Date.now(), abortHandler:null }
    if(signal){
      item.abortHandler=()=>{
        const index=queue.indexOf(item)
        if(index>=0){
          queue.splice(index,1)
          reject(Object.assign(new Error('Operação de IA cancelada enquanto aguardava na fila.'),{code:'AI_ABORTED',status:499}))
        }
      }
      if(signal.aborted)return item.abortHandler()
      signal.addEventListener('abort',item.abortHandler,{once:true})
    }
    queue.push(item)
    sortQueue(); pump()
  })
}

export function getAiQueueStats() {
  const pendingByPriority = {}
  for (const item of queue) pendingByPriority[item.priority] = (pendingByPriority[item.priority] || 0) + 1
  return { active, pending: queue.length, concurrency: CONCURRENCY, maxQueue: MAX_QUEUE, pendingByPriority }
}
