const express = require('express')
const bcrypt = require('bcryptjs')
const { getState, persistOne, deleteOne, genId } = require('../store')
const { requireAuth } = require('../middleware/requireAuth')

const router = express.Router()
router.use(requireAuth('superadmin'))

router.get('/me', (_req, res) => {
  res.json({
    id: 'superadmin',
    email: process.env.SUPERADMIN_EMAIL,
    role: 'superadmin',
  })
})

router.get('/dashboard', async (_req, res) => {
  const { admins, clients } = await getState()
  const activeAdmins = admins.filter((a) => a.status === 'active').length
  const recentAdmins = [...admins]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8)
    .map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      status: a.status,
      clients: clients.filter((c) => c.adminId === a.id).length,
      createdAt: a.createdAt,
    }))
  res.json({
    stats: {
      totalAdmins: admins.length,
      activeAdmins,
      totalClients: clients.length,
    },
    recentAdmins,
  })
})

router.get('/admins', async (_req, res) => {
  const { admins, clients } = await getState()
  const list = admins.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    status: a.status,
    bootstrapFromEnv: Boolean(a.bootstrapFromEnv),
    clients: clients.filter((c) => c.adminId === a.id).length,
    createdAt: a.createdAt,
  }))
  res.json({ admins: list })
})

router.post('/admins', async (req, res) => {
  const { name, email, password } = req.body || {}
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'Name, email and password required' })
  }
  const state = await getState()
  const exists = state.admins.some((a) => a.email.toLowerCase() === email.trim().toLowerCase())
  if (exists) {
    return res.status(409).json({ error: 'Email already registered' })
  }
  const admin = {
    id: genId('adm'),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    passwordHash: bcrypt.hashSync(password, 10),
    status: 'active',
    createdAt: new Date().toISOString(),
  }
  await persistOne('admin', admin.id, admin)
  res.status(201).json({
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      status: admin.status,
      clients: 0,
      createdAt: admin.createdAt,
    },
  })
})

router.patch('/admins/:id', async (req, res) => {
  const { id } = req.params
  const { name, status } = req.body || {}
  const state = await getState()
  const idx = state.admins.findIndex((a) => a.id === id)
  if (idx === -1) return res.status(404).json({ error: 'Admin not found' })
  const prev = state.admins[idx]
  const next = {
    ...prev,
    ...(name != null && name.trim() ? { name: name.trim() } : {}),
    ...(status === 'active' || status === 'inactive' ? { status } : {}),
  }
  await persistOne('admin', next.id, next)
  const { clients } = await getState()
  res.json({
    admin: {
      id: next.id,
      name: next.name,
      email: next.email,
      status: next.status,
      clients: clients.filter((c) => c.adminId === next.id).length,
    },
  })
})

router.delete('/admins/:id', async (req, res) => {
  const { id } = req.params
  const state = await getState()
  const admin = state.admins.find((a) => a.id === id)
  if (!admin) return res.status(404).json({ error: 'Admin not found' })
  const clientsLeft = state.clients.some((c) => c.adminId === id)
  if (clientsLeft) {
    return res.status(400).json({ error: 'Remove or reassign clients before deleting admin' })
  }
  await deleteOne('admin', id)
  res.json({ ok: true })
})

router.get('/apps', async (_req, res) => {
  const { apps, clients, admins } = await getState()
  const adminMap = Object.fromEntries(admins.map((a) => [a.id, a.name]))
  const list = apps.map((a) => {
    const appClients = clients.filter((c) => c.appId === a.id && c.source !== 'Portal')
    return {
      id: a.id,
      name: a.name,
      clientCount: appClients.length,
      clients: appClients.map((c) => ({
        id: c.id,
        fullName: c.fullName,
        businessName: c.businessName,
        email: c.email,
        mobile: c.mobile,
        businessLogoKey: c.businessLogoKey || '',
        gstNumber: c.gstNumber || '',
        panNumber: c.panNumber || '',
        status: c.status,
        kyc: c.kyc,
        source: c.source,
        adminName: adminMap[c.adminId] || 'Unknown',
        city: c.city || '',
        websiteUrl: c.websiteUrl || '',
        createdAt: c.createdAt,
      }))
    }
  })
  res.json({ apps: list })
})

router.get('/clients', async (_req, res) => {
  const { clients, admins } = await getState()
  const adminMap = Object.fromEntries(admins.map((a) => [a.id, a.name]))
  const list = clients
    .filter((c) => c.source === 'Portal')
    .map((c) => ({
      id: c.id,
      adminId: c.adminId,
      adminName: adminMap[c.adminId] || 'Unknown',
      appId: c.appId,
      fullName: c.fullName,
      businessName: c.businessName,
      email: c.email,
      mobile: c.mobile,
      status: c.status,
      kyc: c.kyc,
      gstNumber: c.gstNumber || '',
      panNumber: c.panNumber || '',
      source: c.source,
      owner: c.owner,
      agents: c.agents,
      createdAt: c.createdAt,
    }))
  res.json({ clients: list })
})

router.post('/apps/:appId/impersonate', async (req, res) => {
  const { appId } = req.params
  const { clients } = await getState()
  const client = clients.find((c) => c.appId === appId && c.source !== 'Portal')
  if (!client) return res.status(404).json({ error: 'No client found for this app' })
  const { sign } = require('../auth')
  const token = sign({
    role: 'client',
    sub: client.id,
    email: client.email,
    adminId: client.adminId,
    appId: client.appId,
    businessName: client.businessName,
    status: client.status,
    source: client.source || 'Direct',
  })
  res.json({ token })
})

router.post('/clients/:id/impersonate', async (req, res) => {
  const { id } = req.params
  const { clients } = await getState()
  const client = clients.find((c) => c.id === id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  const { sign } = require('../auth')
  const token = sign({
    role: 'client',
    sub: client.id,
    email: client.email,
    adminId: client.adminId,
    appId: client.appId,
    businessName: client.businessName,
    status: client.status,
    source: client.source || 'Portal',
  })
  res.json({ token })
})

router.post('/admins/:id/impersonate', async (req, res) => {
  const { id } = req.params
  const state = await getState()
  const admin = state.admins.find((a) => a.id === id)
  if (!admin) return res.status(404).json({ error: 'Admin not found' })
  const { sign } = require('../auth')
  const token = sign({ sub: admin.id, email: admin.email, name: admin.name, role: 'admin' })
  res.json({ token })
})

module.exports = router
