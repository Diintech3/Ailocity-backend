const express = require('express')
const bcrypt = require('bcryptjs')
const { sign } = require('../auth')
const { getState } = require('../store')

const router = express.Router()

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return require('crypto').timingSafeEqual(bufA, bufB)
}

router.post('/superadmin/login', (req, res) => {
  const { email, password } = req.body || {}
  const envEmail = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase()
  const envPass = process.env.SUPERADMIN_PASSWORD || ''
  if (!envEmail || !envPass) {
    return res.status(500).json({ error: 'Superadmin credentials not configured in environment' })
  }
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }
  const okEmail = email.trim().toLowerCase() === envEmail
  const okPass = timingSafeEqual(password, envPass)
  if (!okEmail || !okPass) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  const token = sign({
    role: 'superadmin',
    sub: 'superadmin',
    email: envEmail,
  })
  res.json({
    token,
    user: { id: 'superadmin', email: envEmail, role: 'superadmin' },
  })
})

router.post('/admin/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }
  const { admins } = await getState()
  const admin = admins.find((a) => a.email.toLowerCase() === email.trim().toLowerCase())
  if (!admin || admin.status !== 'active') {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  const match = bcrypt.compareSync(password, admin.passwordHash)
  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  const token = sign({
    role: 'admin',
    sub: admin.id,
    email: admin.email,
    name: admin.name,
  })
  res.json({
    token,
    user: { id: admin.id, email: admin.email, name: admin.name, role: 'admin' },
  })
})

router.post('/client/login', async (req, res) => {
  const { email, password, appId } = req.body || {}
  if (!email || !password || !appId) {
    return res.status(400).json({ error: 'Email, password and app required' })
  }
  const { clients, apps } = await getState()
  const appOk = apps.some((a) => a.id === appId)
  if (!appOk) {
    return res.status(400).json({ error: 'Unknown app' })
  }
  const client = clients.find(
    (c) =>
      c.email.toLowerCase() === email.trim().toLowerCase() &&
      c.appId === appId,
  )
  if (!client) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  if (!bcrypt.compareSync(password, client.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  // Role is determined by appId — each app gets its own isolated role
  const APP_ROLE = {
    'ailocity':          'app',
    'ailocity-business': 'business',
    'ailocity-bd':       'bd',
  }
  const role = APP_ROLE[client.appId] || 'app'

  const token = sign({
    role,
    sub: client.id,
    email: client.email,
    adminId: client.adminId,
    appId: client.appId,
    businessName: client.businessName,
    status: client.status,
    source: client.source || 'Direct',
  })
  res.json({
    token,
    user: {
      id: client.id,
      email: client.email,
      role,
      fullName: client.fullName,
      businessName: client.businessName,
      appId: client.appId,
      status: client.status,
      creditsBalance: client.creditsBalance,
    },
  })
})

module.exports = router
