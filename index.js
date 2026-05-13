require('dotenv').config()
const express   = require('express')
const cors      = require('cors')
const bcrypt    = require('bcryptjs')
const mongoose  = require('mongoose')
const crypto    = require('crypto')
const log       = require('./src/logger')
const {
  connectMongo,
  getState,
  persistOne,
  genId,
  seedAndMigrate,
} = require('./src/store')

const DEFAULT_PORT = 5000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureJwtSecret() {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      log.error('JWT_SECRET must be at least 16 characters in production')
      process.exit(1)
    }
    log.warn('JWT_SECRET is unset or too short — set a strong secret before deploying')
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'temporary-change-before-production'
  }
}

async function bootstrapEnvAdmin() {
  const email    = (process.env.ADMIN_EMAIL    || '').trim().toLowerCase()
  const password =  process.env.ADMIN_PASSWORD || ''
  const name     = (process.env.ADMIN_NAME     || 'Admin').trim()
  if (!email || !password) return

  const state  = await getState()
  const exists = state.admins.some((a) => a.email.toLowerCase() === email)
  if (exists) return

  const admin = {
    id:              genId('adm'),
    name,
    email,
    passwordHash:    bcrypt.hashSync(password, 10),
    status:          'active',
    createdAt:       new Date().toISOString(),
    bootstrapFromEnv: true,
  }
  await persistOne('admin', admin.id, admin)
  log.info('Bootstrap admin account created', { email })
}

// ─── Routes ──────────────────────────────────────────────────────────────────

function registerRoutes(app) {
  app.get('/api/health', (_req, res) => {
    res.json({
      ok:       true,
      service:  'ailocity-api',
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    })
  })

  app.use('/api/apps',        require('./src/routes/apps'))
  app.use('/api/auth',        require('./src/routes/auth'))
  app.use('/api/superadmin',  require('./src/routes/superadmin'))
  app.use('/api/admin',       require('./src/routes/admin'))
  app.use('/api/business',      require('./src/routes/businessPortal'))
  app.use('/api/bd',          require('./src/routes/bdPortal'))
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function start() {
  ensureJwtSecret()
  await connectMongo()
  await seedAndMigrate()
  await bootstrapEnvAdmin()

  const app = express()

  // Attach a short request-id to every request
  app.use((req, _res, next) => {
    req.id = crypto.randomBytes(4).toString('hex')
    next()
  })

  // Access log
  app.use((req, res, next) => {
    const started = Date.now()
    res.on('finish', () => {
      const path = (req.originalUrl || req.url).split('?')[0]
      log.http(req.method, path, res.statusCode, Date.now() - started, req.id)
    })
    next()
  })

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : true
  app.use(cors({ origin: allowedOrigins, credentials: true }))
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ limit: '10mb', extended: true }))

  registerRoutes(app)

  // Global error handler
  app.use((err, req, _res, next) => {
    log.error(err.message || String(err), { reqId: req.id, stack: err.stack?.split('\n')[1]?.trim() })
    next(err)
  })

  const rawPort    = process.env.PORT
  const port       = Number(rawPort)
  const listenPort = Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT

  if (rawPort !== undefined && rawPort !== '' && !Number.isFinite(port)) {
    log.warn('PORT env value is invalid — using default', { default: DEFAULT_PORT })
  }

  const server = app.listen(listenPort, '0.0.0.0', () => {
    log.info(`Server ready on port ${listenPort}`)
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.error('Port already in use', { port: listenPort })
    } else {
      log.error(err.message, { code: err.code })
    }
    process.exit(1)
  })

  // Graceful shutdown
  const shutdown = (signal) => {
    log.info(`${signal} received — shutting down gracefully`)
    server.close(() => {
      mongoose.connection.close(false).then(() => {
        log.info('Shutdown complete')
        process.exit(0)
      })
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
}

start().catch((err) => {
  log.error(err.message || String(err))
  process.exit(1)
})
