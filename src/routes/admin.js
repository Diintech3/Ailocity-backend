const express = require('express')
const bcrypt = require('bcryptjs')
const multer = require('multer')
const { getState, persist, persistOne, deleteOne, genId, getTerritoryTree, createState, createCity, createRegion, createPod, getStates, getCitiesByState, getRegionsByCity, getPodsByRegion, getPodClientCount } = require('../store')
const { requireAuth } = require('../middleware/requireAuth')
const { sign } = require('../auth')
const { uploadToR2, getPresignedUrl } = require('../r2')

const router = express.Router()
router.use(requireAuth('admin'))

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// ── Upload business logo to R2 ──────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })
  try {
    const key = await uploadToR2(req.file.buffer, req.file.originalname, req.file.mimetype)
    res.json({ key })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Upload failed' })
  }
})

// ── Get presigned URL for an image key ───────────────────────────────────────
router.get('/presigned-url', async (req, res) => {
  const { key } = req.query
  if (!key) return res.status(400).json({ error: 'key is required' })
  try {
    const url = await getPresignedUrl(key)
    res.json({ url })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to generate URL' })
  }
})

router.get('/me', async (req, res) => {
  const { admins } = await getState()
  const admin = admins.find((a) => a.id === req.user.sub)
  if (!admin) return res.status(404).json({ error: 'Admin not found' })
  res.json({
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: 'admin',
    status: admin.status,
  })
})

router.get('/dashboard', async (req, res) => {
  const adminId = req.user.sub
  const { clients } = await getState()
  const mine = clients.filter((c) => c.adminId === adminId && c.source !== 'Portal')
  const prime = mine.filter((c) => c.status === 'prime').length
  const agentsSum = mine.reduce((s, c) => s + (Number(c.agents) || 0), 0)
  const recent = [...mine]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5)
    .map(publicClientRow)
  res.json({
    stats: {
      totalClients: mine.length,
      primeClients: prime,
      activeAgents: agentsSum,
    },
    recentClients: recent,
  })
})

function publicClientRow(c) {
  return {
    id: c.id,
    name: c.fullName,
    business: c.businessName,
    email: c.email,
    mobile: c.mobile,
    status: c.status,
    source: c.source,
    agents: c.agents,
    owner: c.owner,
    kyc: c.kyc,
    appId: c.appId,
    businessLogoKey: c.businessLogoKey || '',
    websiteUrl: c.websiteUrl || '',
    gstNumber: c.gstNumber || '',
    panNumber: c.panNumber || '',
    city: c.city || '',
    address: c.address || '',
    pincode: c.pincode || '',
  }
}

router.get('/apps', async (req, res) => {
  const adminId = req.user.sub
  const { status: statusQ, search } = req.query
  let list = (await getState()).clients.filter((c) => c.adminId === adminId && c.source !== 'Portal')
  if (statusQ && statusQ !== 'all') {
    list = list.filter((c) => c.status === statusQ)
  }
  if (search && String(search).trim()) {
    const q = String(search).trim().toLowerCase()
    list = list.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.businessName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q),
    )
  }
  res.json({ clients: list.map(publicClientRow) })
})

/** Static path must be registered before `/apps/:id` or Express treats `tab-counts` as an id. */
router.get('/apps/tab-counts', async (req, res) => {
  const adminId = req.user.sub
  const mine = (await getState()).clients.filter((c) => c.adminId === adminId && c.source !== 'Portal')
  const counts = { all: mine.length }
  for (const c of mine) {
    counts[c.status] = (counts[c.status] || 0) + 1
  }
  res.json({ counts })
})

router.post('/apps', async (req, res) => {
  const adminId = req.user.sub
  const body = req.body || {}
  const {
    businessName,
    websiteUrl,
    gstNumber,
    panNumber,
    fullName,
    email,
    mobile,
    address,
    city,
    pincode,
    password,
    appId,
    businessLogoKey,
    status,
    source,
    owner,
    agents,
    kyc,
  } = body

  if (!businessName?.trim() || !fullName?.trim() || !email?.trim() || !mobile?.trim() || !password || !appId) {
    return res.status(400).json({ error: 'Business name, full name, email, mobile, password and app are required' })
  }

  const state = await getState()
  if (!state.apps.some((a) => a.id === appId)) {
    return res.status(400).json({ error: 'Unknown app' })
  }
  const dup = state.clients.some(
    (c) => c.email.toLowerCase() === email.trim().toLowerCase() && c.appId === appId,
  )
  if (dup) {
    return res.status(409).json({ error: 'Client email already exists for this app' })
  }

  const client = {
    id: genId('cli'),
    adminId,
    appId,
    fullName: fullName.trim(),
    email: email.trim().toLowerCase(),
    passwordHash: bcrypt.hashSync(password, 10),
    businessName: businessName.trim(),
    websiteUrl: websiteUrl?.trim() || '',
    gstNumber: gstNumber?.trim() || '',
    panNumber: panNumber?.trim() || '',
    businessLogoKey: businessLogoKey?.trim() || '',
    mobile: mobile.trim(),
    address: address?.trim() || '',
    city: city?.trim() || '',
    pincode: pincode?.trim() || '',
    status: ['new', 'prime', 'demo', 'testing', 'rejected', 'in-house'].includes(status)
      ? status
      : 'new',
    kyc: ['verified', 'pending', 'rejected'].includes(kyc) ? kyc : 'pending',
    source: source?.trim() || 'Direct',
    owner: owner?.trim() || state.admins.find((a) => a.id === adminId)?.name || 'Owner',
    agents: Number(agents) >= 0 ? Number(agents) : 0,
    creditsBalance: 0,
    totalCalls: 0,
    activeAgentsCount: 0,
    createdAt: new Date().toISOString(),
    portalAgents: [],
    portalTickets: [],
    usageStats: [],
  }

  await persistOne('client', client.id, client)
  res.status(201).json({ client: publicClientRow(client) })
})

router.get('/apps/:id', async (req, res) => {
  const adminId = req.user.sub
  const c = (await getState()).clients.find((x) => x.id === req.params.id && x.adminId === adminId)
  if (!c) return res.status(404).json({ error: 'Not found' })
  res.json({ client: publicClientRow(c) })
})

router.patch('/apps/:id', async (req, res) => {
  const adminId = req.user.sub
  const state = await getState()
  const idx = state.clients.findIndex((x) => x.id === req.params.id && x.adminId === adminId)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  const prev = state.clients[idx]
  const b = req.body || {}
  const next = {
    ...prev,
    ...(b.fullName?.trim() ? { fullName: b.fullName.trim() } : {}),
    ...(b.businessName?.trim() ? { businessName: b.businessName.trim() } : {}),
    ...(b.mobile?.trim() ? { mobile: b.mobile.trim() } : {}),
    ...(b.websiteUrl !== undefined ? { websiteUrl: String(b.websiteUrl).trim() } : {}),
    ...(b.gstNumber !== undefined ? { gstNumber: String(b.gstNumber).trim() } : {}),
    ...(b.panNumber !== undefined ? { panNumber: String(b.panNumber).trim() } : {}),
    ...(b.address !== undefined ? { address: String(b.address).trim() } : {}),
    ...(b.city !== undefined ? { city: String(b.city).trim() } : {}),
    ...(b.pincode !== undefined ? { pincode: String(b.pincode).trim() } : {}),
    ...(b.businessLogoKey !== undefined ? { businessLogoKey: String(b.businessLogoKey).trim() } : {}),
    ...(b.source?.trim() ? { source: b.source.trim() } : {}),
    ...(b.owner?.trim() ? { owner: b.owner.trim() } : {}),
    ...(Number.isFinite(Number(b.agents)) ? { agents: Number(b.agents) } : {}),
    ...(['verified', 'pending', 'rejected'].includes(b.kyc) ? { kyc: b.kyc } : {}),
    ...(['new', 'prime', 'demo', 'testing', 'rejected', 'in-house'].includes(b.status)
      ? { status: b.status }
      : {}),
    ...(Number.isFinite(Number(b.creditsBalance)) ? { creditsBalance: Number(b.creditsBalance) } : {}),
    ...(['ailocity', 'ailocity-bd', 'ailocity-business', 'ailocity-tc'].includes(b.appId) ? { appId: b.appId } : {}),
  }
  await persistOne('client', next.id, next)
  res.json({ client: publicClientRow(next) })
})

router.delete('/apps/:id', async (req, res) => {
  const adminId = req.user.sub
  const state = await getState()
  const exists = state.clients.some((x) => x.id === req.params.id && x.adminId === adminId)
  if (!exists) return res.status(404).json({ error: 'Not found' })
  await deleteOne('client', req.params.id)
  res.json({ ok: true })
})

router.post('/apps/:id/impersonate', async (req, res) => {
  const adminId = req.user.sub
  const state = await getState()
  const client = state.clients.find((c) => c.id === req.params.id && c.adminId === adminId)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  const APP_ROLE = { 'ailocity': 'app', 'ailocity-business': 'business', 'ailocity-bd': 'bd', 'ailocity-tc': 'app' }
  const token = sign({
    role: APP_ROLE[client.appId] || 'app',
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

// ── Territory Management APIs ────────────────────────────────────────────────────────────

// GET full territory tree
router.get('/territories', async (req, res) => {
  try {
    const tree = await getTerritoryTree()
    res.json({ states: tree })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET all states
router.get('/territories/states', async (req, res) => {
  try {
    const states = await getStates()
    res.json({ states })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST create state
router.post('/territories/states', async (req, res) => {
  try {
    const { name, code } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
    const data = { id: genId('st'), name: name.trim(), code: (code || '').trim().toUpperCase(), isActive: true, createdAt: new Date().toISOString() }
    await createState(data)
    res.json({ state: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET cities by state
router.get('/territories/cities', async (req, res) => {
  try {
    const { stateId } = req.query
    if (!stateId) return res.status(400).json({ error: 'stateId is required' })
    const cities = await getCitiesByState(stateId)
    res.json({ cities })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST create city
router.post('/territories/cities', async (req, res) => {
  try {
    const { stateId, name } = req.body
    if (!stateId || !name?.trim()) return res.status(400).json({ error: 'stateId and name are required' })
    const data = { id: genId('ct'), stateId, name: name.trim(), isActive: true, createdAt: new Date().toISOString() }
    await createCity(data)
    res.json({ city: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET regions by city
router.get('/territories/regions', async (req, res) => {
  try {
    const { cityId } = req.query
    if (!cityId) return res.status(400).json({ error: 'cityId is required' })
    const regions = await getRegionsByCity(cityId)
    res.json({ regions })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST create region
router.post('/territories/regions', async (req, res) => {
  try {
    const { stateId, cityId, name } = req.body
    if (!stateId || !cityId || !name?.trim()) return res.status(400).json({ error: 'stateId, cityId and name are required' })
    const validRegions = ['North', 'South', 'East', 'West', 'Central']
    if (!validRegions.includes(name)) return res.status(400).json({ error: `name must be one of: ${validRegions.join(', ')}` })
    const data = { id: genId('rg'), stateId, cityId, name, isActive: true, createdAt: new Date().toISOString() }
    await createRegion(data)
    res.json({ region: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET pods by region
router.get('/territories/pods', async (req, res) => {
  try {
    const { regionId } = req.query
    if (!regionId) return res.status(400).json({ error: 'regionId is required' })
    const pods = await getPodsByRegion(regionId)
    res.json({ pods })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST create POD
router.post('/territories/pods', async (req, res) => {
  try {
    const { stateId, cityId, regionId, podNumber, podName, capacity } = req.body
    if (!stateId || !cityId || !regionId || !podNumber?.trim() || !podName?.trim())
      return res.status(400).json({ error: 'stateId, cityId, regionId, podNumber and podName are required' })
    const data = {
      id: genId('pd'),
      stateId, cityId, regionId,
      podNumber: podNumber.trim().toUpperCase(),
      podName: podName.trim(),
      capacity: capacity || 100,
      isActive: true,
      createdAt: new Date().toISOString()
    }
    await createPod(data)
    res.json({ pod: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET POD client count
router.get('/territories/pods/:podId/clients/count', async (req, res) => {
  try {
    const count = await getPodClientCount(req.params.podId)
    res.json({ count })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
