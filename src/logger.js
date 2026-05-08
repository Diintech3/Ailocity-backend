/**
 * Structured logger — Ailocity API
 *
 * Development : coloured human-readable lines
 * Production  : newline-delimited JSON (LOG_FORMAT=json forces it anywhere)
 *
 * Env vars
 *   LOG_LEVEL   error | warn | info | debug   (default: info)
 *   LOG_FORMAT  json | text                   (default: json in prod, text otherwise)
 *   LOG_HTTP    0 | 1                         (default: 1 in dev, 0 in prod)
 */

'use strict'

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 }

const isProd      = process.env.NODE_ENV === 'production'
const minLevel    = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info
const jsonMode    = process.env.LOG_FORMAT === 'json' || (isProd && process.env.LOG_FORMAT !== 'text')
const logHttp     = process.env.LOG_HTTP === '1' || (!isProd && process.env.LOG_HTTP !== '0')

// ANSI colours (no-op in JSON mode or when stdout is not a TTY)
const useColour = !jsonMode && process.stdout.isTTY
const C = {
  reset:  useColour ? '\x1b[0m'  : '',
  dim:    useColour ? '\x1b[2m'  : '',
  bold:   useColour ? '\x1b[1m'  : '',
  red:    useColour ? '\x1b[31m' : '',
  yellow: useColour ? '\x1b[33m' : '',
  cyan:   useColour ? '\x1b[36m' : '',
  green:  useColour ? '\x1b[32m' : '',
  blue:   useColour ? '\x1b[34m' : '',
  grey:   useColour ? '\x1b[90m' : '',
}

const LEVEL_COLOUR = {
  error: C.red    + C.bold,
  warn:  C.yellow + C.bold,
  info:  C.cyan,
  debug: C.grey,
}

const STATUS_COLOUR = (code) => {
  if (code >= 500) return C.red
  if (code >= 400) return C.yellow
  if (code >= 300) return C.blue
  return C.green
}

function metaStr(obj) {
  if (!obj || typeof obj !== 'object') return ''
  const pairs = Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${C.grey}${k}${C.reset}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ')
  return pairs ? `  ${pairs}` : ''
}

function writeText(level, msg, meta, stream) {
  const lc = LEVEL_COLOUR[level] || ''
  stream.write(`${lc}${msg}${C.reset}${metaStr(meta)}\n`)
}

function writeJson(level, msg, meta, stream) {
  stream.write(JSON.stringify({ level, msg, ...meta }) + '\n')
}

function write(level, msg, meta, stream) {
  if (LEVELS[level] > minLevel) return
  jsonMode ? writeJson(level, msg, meta, stream) : writeText(level, msg, meta, stream)
}

// ─── Public API ──────────────────────────────────────────────────────────────

function debug(msg, meta) { write('debug', msg, meta, process.stdout) }
function info (msg, meta) { write('info',  msg, meta, process.stdout) }
function warn (msg, meta) { write('warn',  msg, meta, process.stderr) }
function error(msg, meta) { write('error', msg, meta, process.stderr) }

/**
 * HTTP access line.
 * @param {string}  method
 * @param {string}  path        — already stripped of query string
 * @param {number}  status
 * @param {number}  ms          — response time in milliseconds
 * @param {string}  [reqId]     — optional request-id
 */
function http(method, path, status, ms, reqId) {
  if (!logHttp || LEVELS.info > minLevel) return

  if (jsonMode) {
    const entry = { level: 'access', method, path, status, ms }
    if (reqId) entry.reqId = reqId
    process.stdout.write(JSON.stringify(entry) + '\n')
    return
  }

  const sc   = STATUS_COLOUR(status)
  const id   = reqId ? `${C.grey}[${reqId}]${C.reset}  ` : ''
  const meth = `${C.bold}${method.padEnd(7)}${C.reset}`
  const st   = `${sc}${status}${C.reset}`
  const dur  = ms < 100 ? `${C.green}${ms}ms${C.reset}` : ms < 500 ? `${C.yellow}${ms}ms${C.reset}` : `${C.red}${ms}ms${C.reset}`

  process.stdout.write(`${id}${meth}  ${path}  ${st}  ${dur}\n`)
}

module.exports = { debug, info, warn, error, http }
