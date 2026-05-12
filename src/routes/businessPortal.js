const express = require('express')
const multer = require('multer')
const bcrypt = require('bcryptjs')
const { getState, persistOne, deleteOne, genId, getTerritoryTree, createState, createCity, createRegion, createPod } = require('../store')
const { requireAuth } = require('../middleware/requireAuth')
const { uploadToR2, getPresignedUrl } = require('../r2')
const { sign } = require('../auth')

const { sendMeetingEmail, meetingEmailHtml } = require('../email')

// ── Groq AI ──────────────────────────────────────────────────────────────────
const Groq = require('groq-sdk')
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const CATEGORY_MAP = {
  'Real Estate': ['Residential','Commercial','Plots','Rental'],
  'Healthcare': ['Hospital','Clinic','Pharmacy','Lab'],
  'Education': ['School','College','Coaching','Online'],
  'Retail': ['Grocery','Fashion','Electronics','General'],
  'Restaurant / Food': ['Restaurant','Cafe','Cloud Kitchen','Catering'],
  'IT / Software': ['Web Dev','App Dev','SaaS','Agency'],
  'Finance': ['CA','Insurance','Loans','Investment'],
  'Manufacturing': ['FMCG','Industrial','Textile','Auto Parts'],
  'Logistics': ['Transport','Courier','Warehouse'],
  'Salon / Beauty': ['Salon','Spa','Makeup','Skincare'],
  'Gym / Fitness': ['Gym','Yoga','Sports','Nutrition'],
  'Legal': ['Advocate','Law Firm','Compliance'],
  'Travel': ['Tour Operator','Hotel','Visa','Cab'],
  'Automobile': ['Showroom','Service Center','Spare Parts'],
  'Other': ['Other'],
}

const router = express.Router()
router.use(requireAuth(['app', 'business', 'bd']))


const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// ── Upload file to R2 ────────────────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })
  try {
    const key = await uploadToR2(req.file.buffer, req.file.originalname, req.file.mimetype)
    res.json({ key })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Upload failed' })
  }
})

// ── Presigned URL ────────────────────────────────────────────────────────────
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



async function myClient(req) {
  const state = await getState()
  return state.clients.find((c) => c.id === req.user.sub) || null
}

async function patchClient(req, updater) {
  const state = await getState()
  const idx = state.clients.findIndex((c) => c.id === req.user.sub)
  if (idx === -1) return null
  const updated = updater(state.clients[idx])
  await persistOne('client', updated.id, updated)
  return updated
}

router.get('/territories', async (req, res) => {
  try {
    const tree = await getTerritoryTree()
    res.json({ states: tree })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/territories/states', async (req, res) => {
  try {
    const { name, code } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
    const data = { id: genId('st'), name: name.trim(), code: (code || '').trim().toUpperCase(), isActive: true, createdAt: new Date().toISOString() }
    await createState(data)
    res.json({ state: data })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/territories/cities', async (req, res) => {
  try {
    const { stateId, name } = req.body
    if (!stateId || !name?.trim()) return res.status(400).json({ error: 'stateId and name are required' })
    const data = { id: genId('ct'), stateId, name: name.trim(), isActive: true, createdAt: new Date().toISOString() }
    await createCity(data)
    res.json({ city: data })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/territories/regions', async (req, res) => {
  try {
    const { stateId, cityId, name } = req.body
    if (!stateId || !cityId || !name?.trim()) return res.status(400).json({ error: 'stateId, cityId and name are required' })
    const valid = ['North','South','East','West','Central']
    if (!valid.includes(name)) return res.status(400).json({ error: `name must be one of: ${valid.join(', ')}` })
    const data = { id: genId('rg'), stateId, cityId, name, isActive: true, createdAt: new Date().toISOString() }
    await createRegion(data)
    res.json({ region: data })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/territories/pods', async (req, res) => {
  try {
    const { stateId, cityId, regionId, podNumber, podName, capacity } = req.body
    if (!stateId || !cityId || !regionId || !podNumber?.trim() || !podName?.trim())
      return res.status(400).json({ error: 'stateId, cityId, regionId, podNumber and podName are required' })
    const data = { id: genId('pd'), stateId, cityId, regionId, podNumber: podNumber.trim().toUpperCase(), podName: podName.trim(), capacity: capacity || 100, isActive: true, createdAt: new Date().toISOString() }
    await createPod(data)
    res.json({ pod: data })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/me', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  const { apps } = await getState()
  const appName = apps.find((a) => a.id === c.appId)?.name || c.appId
  res.json({
    id: c.id,
    email: c.email,
    fullName: c.fullName,
    businessName: c.businessName,
    businessLogoKey: c.businessLogoKey || '',
    websiteUrl: c.websiteUrl || '',
    gstNumber: c.gstNumber || '',
    panNumber: c.panNumber || '',
    mobile: c.mobile,
    address: c.address || '',
    city: c.city || '',
    pincode: c.pincode || '',
    appId: c.appId,
    appName,
    status: c.status,
    kyc: c.kyc,
    creditsBalance: c.creditsBalance,
    source: c.source || '',
    owner: c.owner || '',
    totalCalls: c.totalCalls ?? 0,
    activeAgentsCount: c.activeAgentsCount ?? 0,
  })
})

router.get('/dashboard', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  const agents = c.portalAgents || []
  const tickets = c.portalTickets || []
  const openTickets = tickets.filter((t) => t.status === 'open' || t.status === 'in-progress').length
  res.json({
    stats: {
      totalCalls: c.totalCalls ?? 0,
      activeAgents: c.activeAgentsCount ?? agents.filter((a) => a.status === 'active').length,
      openTickets,
      creditsLeft: c.creditsBalance ?? 0,
      totalLeads: (c.portalLeads || []).length,
      totalProducts: (c.portalProducts || []).length,
      totalCampaigns: (c.portalCampaigns || []).length,
      totalContent: (c.portalContent || []).length,
    },
    agents,
    tickets,
    recentLeads: (c.portalLeads || []).slice(-5).reverse(),
    recentCampaigns: (c.portalCampaigns || []).slice(-3).reverse(),
  })
})

// ── Agents ──────────────────────────────────────────────────────────────────
router.get('/agents', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ agents: c.portalAgents || [] })
})

// ── Tickets ─────────────────────────────────────────────────────────────────
router.get('/tickets', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ tickets: c.portalTickets || [] })
})

// ── Credits ─────────────────────────────────────────────────────────────────
router.get('/credits', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ creditsBalance: c.creditsBalance ?? 0, usageStats: c.usageStats || [] })
})

// ── Profile ─────────────────────────────────────────────────────────────────
router.patch('/profile', async (req, res) => {
  const b = req.body || {}
  const updated = await patchClient(req, (c) => ({
    ...c,
    ...(b.fullName?.trim() ? { fullName: b.fullName.trim() } : {}),
    ...(b.businessName?.trim() ? { businessName: b.businessName.trim() } : {}),
    ...(b.mobile?.trim() ? { mobile: b.mobile.trim() } : {}),
    ...(b.websiteUrl !== undefined ? { websiteUrl: String(b.websiteUrl).trim() } : {}),
    ...(b.gstNumber !== undefined ? { gstNumber: String(b.gstNumber).trim() } : {}),
    ...(b.panNumber !== undefined ? { panNumber: String(b.panNumber).trim() } : {}),
    ...(b.address !== undefined ? { address: String(b.address).trim() } : {}),
    ...(b.city !== undefined ? { city: String(b.city).trim() } : {}),
    ...(b.pincode !== undefined ? { pincode: String(b.pincode).trim() } : {}),
  }))
  if (!updated) return res.status(404).json({ error: 'Client not found' })
  res.json({ ok: true })
})

// ── Services ─────────────────────────────────────────────────────────────────
router.get('/services', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ services: c.portalServices || [] })
})

router.post('/services', async (req, res) => {
  const b = req.body || {}
  if (!b.name?.trim()) return res.status(400).json({ error: 'name is required' })
  
  const item = {
    id: genId('svc'),
    name: b.name.trim(),
    description: b.description?.trim() || '',
    price: b.price?.trim() || '',
    status: b.status || 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  
  await patchClient(req, (c) => ({ ...c, portalServices: [...(c.portalServices || []), item] }))
  res.status(201).json({ service: item })
})

router.get('/services/:sid', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  const service = (c.portalServices || []).find((s) => s.id === req.params.sid)
  if (!service) return res.status(404).json({ error: 'Service not found' })
  res.json({ service })
})

router.patch('/services/:sid', async (req, res) => {
  const b = req.body || {}
  let found = null
  
  await patchClient(req, (c) => {
    const list = (c.portalServices || []).map((s) => {
      if (s.id !== req.params.sid) return s
      found = {
        ...s,
        ...(b.name?.trim() ? { name: b.name.trim() } : {}),
        ...(b.description !== undefined ? { description: b.description.trim() } : {}),
        ...(b.price !== undefined ? { price: b.price.trim() } : {}),
        ...(b.status ? { status: b.status } : {}),
        updatedAt: new Date().toISOString()
      }
      return found
    })
    return { ...c, portalServices: list }
  })
  
  if (!found) return res.status(404).json({ error: 'Service not found' })
  res.json({ service: found })
})

router.delete('/services/:sid', async (req, res) => {
  let deleted = null
  await patchClient(req, (c) => {
    deleted = (c.portalServices || []).find((s) => s.id === req.params.sid)
    return { ...c, portalServices: (c.portalServices || []).filter((s) => s.id !== req.params.sid) }
  })
  if (!deleted) return res.status(404).json({ error: 'Service not found' })
  res.json({ ok: true, message: 'Service deleted successfully' })
})

// ── Products ─────────────────────────────────────────────────────────────────
router.get('/products', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  const products = c.portalProducts || []
  // Attach presigned URLs for product images
  const withUrls = await Promise.all(
    products.map(async (p) => {
      if (!p.imageKey) return p
      try {
        const imageUrl = await getPresignedUrl(p.imageKey)
        return { ...p, imageUrl }
      } catch {
        return p
      }
    })
  )
  res.json({ products: withUrls })
})

router.post('/products', async (req, res) => {
  const b = req.body || {}
  if (!b.name?.trim()) return res.status(400).json({ error: 'name is required' })
  
  const item = {
    id: genId('prd'),
    name: b.name.trim(),
    description: b.description?.trim() || '',
    price: b.price?.trim() || '',
    category: b.category?.trim() || '',
    imageKey: b.imageKey?.trim() || '',
    status: b.status || 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  
  await patchClient(req, (c) => ({ ...c, portalProducts: [...(c.portalProducts || []), item] }))
  
  let responseItem = item
  if (item.imageKey) {
    try { responseItem = { ...item, imageUrl: await getPresignedUrl(item.imageKey) } } catch {}
  }
  res.status(201).json({ product: responseItem })
})

router.get('/products/:pid', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  const product = (c.portalProducts || []).find((p) => p.id === req.params.pid)
  if (!product) return res.status(404).json({ error: 'Product not found' })
  
  let responseProduct = product
  if (product.imageKey) {
    try { responseProduct = { ...product, imageUrl: await getPresignedUrl(product.imageKey) } } catch {}
  }
  res.json({ product: responseProduct })
})

router.patch('/products/:pid', async (req, res) => {
  const b = req.body || {}
  let found = null
  
  await patchClient(req, (c) => {
    const list = (c.portalProducts || []).map((p) => {
      if (p.id !== req.params.pid) return p
      found = {
        ...p,
        ...(b.name?.trim() ? { name: b.name.trim() } : {}),
        ...(b.description !== undefined ? { description: b.description.trim() } : {}),
        ...(b.price !== undefined ? { price: b.price.trim() } : {}),
        ...(b.category !== undefined ? { category: b.category.trim() } : {}),
        ...(b.imageKey !== undefined ? { imageKey: b.imageKey.trim() } : {}),
        ...(b.status ? { status: b.status } : {}),
        updatedAt: new Date().toISOString()
      }
      return found
    })
    return { ...c, portalProducts: list }
  })
  
  if (!found) return res.status(404).json({ error: 'Product not found' })
  
  let responseProduct = found
  if (found.imageKey) {
    try { responseProduct = { ...found, imageUrl: await getPresignedUrl(found.imageKey) } } catch {}
  }
  res.json({ product: responseProduct })
})

router.delete('/products/:pid', async (req, res) => {
  let deleted = null
  await patchClient(req, (c) => {
    deleted = (c.portalProducts || []).find((p) => p.id === req.params.pid)
    return { ...c, portalProducts: (c.portalProducts || []).filter((p) => p.id !== req.params.pid) }
  })
  if (!deleted) return res.status(404).json({ error: 'Product not found' })
  res.json({ ok: true, message: 'Product deleted successfully' })
})

// ── Contacts ─────────────────────────────────────────────────────────────────
/** TC portal: Business directory is merged from the linked Ailocity Business client (same admin). */
function tcMergedContacts(tcClient, allClients) {
  const own = Array.isArray(tcClient.portalContacts) ? tcClient.portalContacts : []
  const peers = allClients.filter((x) => x.adminId === tcClient.adminId && x.id !== tcClient.id)
  const biz =
    peers.find((x) => x.appId === 'ailocity-business') ||
    peers.find((x) => x.appId === 'ailocity') ||
    [...peers].sort((a, b) => (b.portalContacts?.length || 0) - (a.portalContacts?.length || 0))[0]
  const fromBiz = Array.isArray(biz?.portalContacts) ? biz.portalContacts : []
  if (fromBiz.length === 0) return own
  const seen = new Set(fromBiz.map((x) => String(x.id || '')).filter(Boolean))
  const merged = [...fromBiz]
  for (const row of own) {
    const id = String(row.id || '')
    if (id && !seen.has(id)) {
      seen.add(id)
      merged.push(row)
    }
  }
  return merged
}

router.get('/contacts', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  let contacts = c.portalContacts || []
  if (c.appId === 'ailocity-tc') {
    const { clients } = await getState()
    contacts = tcMergedContacts(c, clients)
  }
  const withUrls = await Promise.all(
    contacts.map(async (x) => {
      const base = { ...x, businessId: x.id }
      if (!x.logoKey) return base
      try {
        const logoUrl = await getPresignedUrl(x.logoKey)
        return { ...base, logoUrl }
      } catch {
        return base
      }
    })
  )
  res.json({ contacts: withUrls })
})
router.post('/contacts', async (req, res) => {
  const b = req.body || {}
  if (!b.name?.trim()) return res.status(400).json({ error: 'name is required' })

  const me = await myClient(req)
  if (!me) return res.status(404).json({ error: 'Client not found' })

  let refClientId = null

  // If email + password provided, register as a new client account
  if (b.email?.trim() && b.password) {
    const state = await getState()
    const existing = state.clients.find(
      (c) => c.email.toLowerCase() === b.email.trim().toLowerCase() && c.appId === me.appId && c.id !== me.id
    )
    if (existing) {
      refClientId = existing.id
    } else {
      const newClient = {
        id: genId('cli'),
        adminId: me.adminId,
        appId: me.appId,
        fullName: b.name.trim(),
        email: b.email.trim().toLowerCase(),
        passwordHash: bcrypt.hashSync(b.password, 10),
        businessName: b.company?.trim() || b.name.trim(),
        businessLogoKey: b.logoKey?.trim() || '',
        websiteUrl: b.websiteUrl?.trim() || '',
        gstNumber: b.gstNumber?.trim() || '',
        panNumber: b.panNumber?.trim() || '',
        mobile: b.mobile?.trim() || '',
        address: b.address?.trim() || '',
        city: b.city?.trim() || '',
        pincode: b.pincode?.trim() || '',
        status: 'new', kyc: 'pending', source: 'Portal',
        owner: me.fullName || 'Owner', agents: 0,
        creditsBalance: 0, totalCalls: 0, activeAgentsCount: 0,
        createdAt: new Date().toISOString(),
        portalAgents: [], portalTickets: [], usageStats: [],
        portalServices: [], portalProducts: [], portalContacts: [],
        portalDataStore: [], portalLeads: [], portalCampaigns: [],
        portalContent: [], portalReels: [],
        portalMeetings: [], portalDialReports: [], portalDialCalls: [],
        portalTcTrainings: [], portalAICalls: [],
      }
      await persistOne('client', newClient.id, newClient)
      refClientId = newClient.id
    }
  }

  const item = {
    id: genId('bus'),
    refClientId,
    name: b.name.trim(),
    email: b.email?.trim() || '',
    mobile: b.mobile?.trim() || '',
    alternateMobile: b.alternateMobile?.trim() || '',
    company: b.company?.trim() || '',
    businessType: b.businessType?.trim() || '',
    category: b.category?.trim() || '',
    subCategory: b.subCategory?.trim() || '',
    websiteUrl: b.websiteUrl?.trim() || '',
    gstNumber: b.gstNumber?.trim() || '',
    panNumber: b.panNumber?.trim() || '',
    address: b.address?.trim() || '',
    city: b.city?.trim() || '',
    state: b.state?.trim() || '',
    pincode: b.pincode?.trim() || '',
    country: b.country?.trim() || 'India',
    instagramUrl: b.instagramUrl?.trim() || '',
    facebookUrl: b.facebookUrl?.trim() || '',
    youtubeUrl: b.youtubeUrl?.trim() || '',
    logoKey: b.logoKey?.trim() || '',
    type: b.type || 'client',
    mbcSubCategory: b.mbcSubCategory?.trim() || '',
    status: b.status || 'active',
    notes: b.notes?.trim() || '',
    // Territory — accept both nested object and flat fields
    territory: b.territory && typeof b.territory === 'object' ? {
      stateId:    b.territory.stateId    || '',
      stateName:  b.territory.stateName  || '',
      cityId:     b.territory.cityId     || '',
      cityName:   b.territory.cityName   || '',
      regionId:   b.territory.regionId   || '',
      regionName: b.territory.regionName || '',
      podId:      b.territory.podId      || '',
      podNumber:  b.territory.podNumber  || '',
      podName:    b.territory.podName    || '',
    } : {
      stateId: b.stateId?.trim() || '', stateName: b.stateName?.trim() || '',
      cityId: b.cityId?.trim() || '', cityName: b.cityName?.trim() || '',
      regionId: b.region?.trim() || '', regionName: b.region?.trim() || '',
      podId: b.podId?.trim() || '', podNumber: b.podNumber?.trim() || '', podName: b.podName?.trim() || '',
    },
    createdAt: new Date().toISOString(),
  }
  await patchClient(req, (c) => ({ ...c, portalContacts: [...(c.portalContacts || []), item] }))
  res.status(201).json({ contact: item })
})

router.post('/contacts/:cid/login', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  const contact = (c.portalContacts || []).find((x) => x.id === req.params.cid)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  let refClientId = contact.refClientId

  // Auto-link by email if refClientId missing
  if (!refClientId && contact.email) {
    const state = await getState()
    const linked = state.clients.find(
      (x) => x.email.toLowerCase() === contact.email.toLowerCase() && x.appId === c.appId && x.id !== c.id
    )
    if (linked) {
      refClientId = linked.id
      await patchClient(req, (cl) => ({
        ...cl,
        portalContacts: (cl.portalContacts || []).map((x) =>
          x.id === req.params.cid ? { ...x, refClientId: linked.id } : x
        ),
      }))
    }
  }

  if (!refClientId) return res.status(400).json({ error: 'No login account. Edit contact and set a password first.' })

  const state = await getState()
  const refClient = state.clients.find((x) => x.id === refClientId)
  if (!refClient) return res.status(404).json({ error: 'Linked client account not found' })

  const APP_ROLE = { 'ailocity': 'app', 'ailocity-business': 'business', 'ailocity-bd': 'bd', 'ailocity-tc': 'app' }
  const token = sign({
    role: APP_ROLE[refClient.appId] || 'app',
    sub: refClient.id,
    email: refClient.email,
    adminId: refClient.adminId,
    appId: refClient.appId,
    businessName: refClient.businessName,
    status: refClient.status,
    source: refClient.source || 'Portal',
  })
  res.json({ token })
})
router.patch('/contacts/:cid', async (req, res) => {
  const b = req.body || {}
  let found = null
  const me = await myClient(req)
  if (!me) return res.status(404).json({ error: 'Client not found' })

  // If password provided and contact has no refClientId, create a new client account
  if (b.password && b.email?.trim()) {
    const state = await getState()
    const contact = (me.portalContacts || []).find((x) => x.id === req.params.cid)
    if (contact && !contact.refClientId) {
      const dup = state.clients.some(
        (c) => c.email.toLowerCase() === b.email.trim().toLowerCase() && c.appId === me.appId
      )
      if (!dup) {
        const newClient = {
          id: genId('cli'),
          adminId: me.adminId,
          appId: me.appId,
          fullName: b.name?.trim() || contact.name,
          email: b.email.trim().toLowerCase(),
          passwordHash: bcrypt.hashSync(b.password, 10),
          businessName: b.company?.trim() || contact.company || contact.name,
          businessLogoKey: b.logoKey?.trim() || contact.logoKey || '',
          websiteUrl: b.websiteUrl?.trim() || contact.websiteUrl || '',
          gstNumber: b.gstNumber?.trim() || contact.gstNumber || '',
          panNumber: b.panNumber?.trim() || contact.panNumber || '',
          mobile: b.mobile?.trim() || contact.mobile || '',
          address: b.address?.trim() || contact.address || '',
          city: b.city?.trim() || contact.city || '',
          pincode: b.pincode?.trim() || contact.pincode || '',
          status: 'new', kyc: 'pending', source: 'Portal',
          owner: me.fullName || 'Owner', agents: 0,
          creditsBalance: 0, totalCalls: 0, activeAgentsCount: 0,
          createdAt: new Date().toISOString(),
          portalAgents: [], portalTickets: [], usageStats: [],
          portalServices: [], portalProducts: [], portalContacts: [],
          portalDataStore: [], portalLeads: [], portalCampaigns: [],
          portalContent: [], portalReels: [],
        }
        await persistOne('client', newClient.id, newClient)
        b.refClientId = newClient.id
      }
    }
  }

  await patchClient(req, (c) => {
    const list = (c.portalContacts || []).map((x) => {
      if (x.id !== req.params.cid) return x
      const updated = { ...x, ...b, id: x.id }
      delete updated.password
      // Merge territory
      if (b.territory && typeof b.territory === 'object') {
        updated.territory = { ...(x.territory || {}), ...b.territory }
      }
      found = updated
      return found
    })
    return { ...c, portalContacts: list }
  })
  if (!found) return res.status(404).json({ error: 'Not found' })
  res.json({ contact: found })
})
router.patch('/contacts/:cid/kyc', async (req, res) => {
  const { kyc } = req.body || {}
  if (!['verified', 'rejected', 'pending'].includes(kyc)) return res.status(400).json({ error: 'Invalid kyc value' })
  let found = null
  const me = await myClient(req)
  if (!me) return res.status(404).json({ error: 'Client not found' })

  await patchClient(req, (c) => {
    const list = (c.portalContacts || []).map((x) => {
      if (x.id !== req.params.cid) return x
      found = { ...x, kyc }
      return found
    })
    return { ...c, portalContacts: list }
  })
  if (!found) return res.status(404).json({ error: 'Contact not found' })

  // Sync kyc to linked client account if exists
  if (found.refClientId) {
    const { clients } = await getState()
    const linked = clients.find(x => x.id === found.refClientId)
    if (linked) await persistOne('client', linked.id, { ...linked, kyc })
  }

  res.json({ ok: true, kyc })
})

router.delete('/contacts/:cid', async (req, res) => {
  await patchClient(req, (c) => ({ ...c, portalContacts: (c.portalContacts || []).filter((x) => x.id !== req.params.cid) }))
  res.json({ ok: true })
})

// ── Data Store ────────────────────────────────────────────────────────────────
router.get('/datastore', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  const items = c.portalDataStore || []
  const withUrls = await Promise.all(
    items.map(async (x) => {
      if (!x.fileKey) return x
      try {
        const fileUrl = await getPresignedUrl(x.fileKey)
        return { ...x, fileUrl }
      } catch {
        return x
      }
    })
  )
  res.json({ items: withUrls })
})
router.post('/datastore', async (req, res) => {
  const b = req.body || {}
  if (!b.title?.trim()) return res.status(400).json({ error: 'title is required' })
  if (!b.type?.trim()) return res.status(400).json({ error: 'type is required' })
  
  const item = {
    id: genId('ds'),
    type: b.type.trim(),
    title: b.title.trim(),
    description: b.description?.trim() || '',
    url: b.url?.trim() || '',
    fileKey: b.fileKey?.trim() || '',
    fileName: b.fileName?.trim() || '',
    fileSize: b.fileSize || 0,
    mimeType: b.mimeType?.trim() || '',
    createdAt: new Date().toISOString()
  }
  await patchClient(req, (c) => ({ ...c, portalDataStore: [...(c.portalDataStore || []), item] }))
  res.status(201).json({ item })
})
router.patch('/datastore/:did', async (req, res) => {
  const b = req.body || {}
  let found = null
  await patchClient(req, (c) => {
    const list = (c.portalDataStore || []).map((x) => {
      if (x.id !== req.params.did) return x
      found = { ...x, ...b, id: x.id }
      return found
    })
    return { ...c, portalDataStore: list }
  })
  if (!found) return res.status(404).json({ error: 'Not found' })
  res.json({ item: found })
})
router.delete('/datastore/:did', async (req, res) => {
  await patchClient(req, (c) => ({ ...c, portalDataStore: (c.portalDataStore || []).filter((f) => f.id !== req.params.did) }))
  res.json({ ok: true })
})

// ── Lead assign: notify BD + copy lead to BD portal ─────────────────────────
async function notifyAndCopyLeadToBD(lead, tcClient) {
  const { clients } = await getState()
  const { getBdUsers } = require('../store')

  // Find which BD client owns this BD user
  let bdClientTarget = null
  let bdUserTarget = null

  // assignedTo can be a BDU_ user id or a BD client id
  if (lead.assignedTo.startsWith('BDU_')) {
    const bdClients = clients.filter(x => x.appId === 'ailocity-bd')
    for (const bdCl of bdClients) {
      const users = await getBdUsers(bdCl.id)
      const u = users.find(u => u.id === lead.assignedTo)
      if (u) { bdClientTarget = bdCl; bdUserTarget = u; break }
    }
  } else {
    bdClientTarget = clients.find(x => x.id === lead.assignedTo && x.appId === 'ailocity-bd')
  }

  if (!bdClientTarget) return

  const notification = {
    id: genId('notif'),
    message: `📋 New Lead Assigned to You\n👤 Name: ${lead.name}\n📞 Mobile: ${lead.mobile || '—'}\n💰 Budget: ${lead.budget ? '₹' + lead.budget : '—'}\n🎯 Priority: ${lead.priority}\n📝 Requirement: ${lead.requirement || '—'}\n\n— ${lead.assignedBy || tcClient.businessName || 'TC'}`,
    sentBy: tcClient.businessName || tcClient.fullName || 'TC',
    sentAt: new Date().toISOString(),
    read: false,
    type: 'lead_assign',
    leadId: lead.id,
  }

  // Copy lead to BD client's portalLeads (upsert by lead.id)
  const bdLeadCopy = {
    ...lead,
    assignedByClientId: tcClient.id,
    assignedBy: tcClient.businessName || tcClient.fullName || 'TC',
    isCopiedFromTC: true,
  }

  const updatedBdClient = {
    ...bdClientTarget,
    portalNotifications: [notification, ...(bdClientTarget.portalNotifications || [])].slice(0, 100),
    portalLeads: [
      bdLeadCopy,
      ...(bdClientTarget.portalLeads || []).filter(x => x.id !== lead.id),
    ],
  }
  await persistOne('client', bdClientTarget.id, updatedBdClient)

  // Send email to BD client
  if (process.env.EMAIL_ENABLED === 'true') {
    const fmtDt = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
    await sendMeetingEmail({
      to: bdClientTarget.email,
      toName: bdClientTarget.businessName || bdClientTarget.fullName,
      subject: `New Lead Assigned: ${lead.name}`,
      html: meetingEmailHtml({
        title: '📋 New Lead Assigned to You',
        rows: [
          ['Lead Name',    lead.name],
          ['Mobile',       lead.mobile || '—'],
          ['Email',        lead.email || '—'],
          ['Source',       lead.source || '—'],
          ['Budget',       lead.budget ? '₹' + lead.budget : '—'],
          ['Priority',     lead.priority],
          ['Status',       lead.status],
          ['Requirement',  lead.requirement || '—'],
          ['Follow Up',    lead.followUpDate ? fmtDt(lead.followUpDate) : '—'],
          ['Assigned By',  lead.assignedBy || tcClient.businessName || 'TC'],
          ['Assigned At',  fmtDt(lead.updatedAt)],
        ],
        note: lead.notes || '',
      }),
    })
  }

  console.log(`[Lead Assign] Lead ${lead.id} assigned to BD ${bdClientTarget.email}, notification sent`)
}

// ── Leads ─────────────────────────────────────────────────────────────────────
router.get('/leads', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  const leads = (c.portalLeads || []).map(l => ({
    ...l,
    assignedTo:   l.assignedTo   ?? '',
    assignedName: l.assignedName ?? '',
    followUpDate: l.followUpDate ?? '',
    notes:        l.notes        ?? '',
    updatedAt:    l.updatedAt    ?? l.createdAt ?? '',
  }))
  res.json({ leads })
})
router.post('/leads', async (req, res) => {
  const b = req.body || {}
  if (!b.name?.trim()) return res.status(400).json({ error: 'name is required' })
  const now = new Date().toISOString()
  const me = await myClient(req)
  if (!me) return res.status(404).json({ error: 'Client not found' })
  const item = {
    id: genId('ld'),
    name: b.name.trim(),
    email: b.email?.trim() || '',
    mobile: b.mobile?.trim() || '',
    source: b.source?.trim() || 'Direct',
    requirement: b.requirement?.trim() || '',
    budget: b.budget?.trim() || '',
    status: b.status || 'new',
    priority: b.priority || 'medium',
    assignedTo: b.assignedTo?.trim() || '',
    assignedName: b.assignedName?.trim() || '',
    followUpDate: b.followUpDate || '',
    notes: b.notes?.trim() || '',
    assignedBy: me.businessName || me.fullName || 'TC',
    assignedByClientId: me.id,
    createdAt: now,
    updatedAt: now,
  }
  await patchClient(req, (c) => ({ ...c, portalLeads: [...(c.portalLeads || []), item] }))

  // If assigned to a BD user — notify BD + copy lead to BD portal
  if (item.assignedTo) {
    try {
      await notifyAndCopyLeadToBD(item, me)
    } catch (e) {
      console.error('[Lead Assign]', e?.message)
    }
  }

  res.status(201).json({ lead: item })
})

router.patch('/leads/:lid', async (req, res) => {
  const b = req.body || {}
  let found = null
  let prevAssignedTo = null
  const me = await myClient(req)
  if (!me) return res.status(404).json({ error: 'Client not found' })

  await patchClient(req, (c) => {
    const list = (c.portalLeads || []).map((x) => {
      if (x.id !== req.params.lid) return x
      prevAssignedTo = x.assignedTo
      found = { ...x, ...b, id: x.id, updatedAt: new Date().toISOString() }
      return found
    })
    return { ...c, portalLeads: list }
  })
  if (!found) return res.status(404).json({ error: 'Not found' })

  // If assignedTo changed — notify new BD + copy/update lead
  if (found.assignedTo && found.assignedTo !== prevAssignedTo) {
    try {
      await notifyAndCopyLeadToBD(found, me)
    } catch (e) {
      console.error('[Lead Assign]', e?.message)
    }
  }

  res.json({ lead: found })
})
router.delete('/leads/:lid', async (req, res) => {
  await patchClient(req, (c) => ({ ...c, portalLeads: (c.portalLeads || []).filter((x) => x.id !== req.params.lid) }))
  res.json({ ok: true })
})

// ── Campaigns ─────────────────────────────────────────────────────────────────
// ── BD: update assigned lead + sync back to TC ──────────────────────────────
router.patch('/leads/:lid/bd-update', async (req, res) => {
  const b = req.body || {}
  const me = await myClient(req)
  if (!me) return res.status(404).json({ error: 'Client not found' })

  let found = null
  await patchClient(req, (c) => {
    const list = (c.portalLeads || []).map((x) => {
      if (x.id !== req.params.lid) return x
      found = {
        ...x,
        ...(b.status       !== undefined ? { status:       b.status }       : {}),
        ...(b.followUpDate !== undefined ? { followUpDate: b.followUpDate } : {}),
        ...(b.bdNotes      !== undefined ? { bdNotes:      b.bdNotes }      : {}),
        updatedAt: new Date().toISOString(),
      }
      return found
    })
    return { ...c, portalLeads: list }
  })
  if (!found) return res.status(404).json({ error: 'Lead not found' })

  // Sync back to TC
  try {
    const { clients } = await getState()
    const tcClient = clients.find(x => x.id === found.assignedByClientId)
    if (tcClient) {
      const updatedLeads = (tcClient.portalLeads || []).map(x =>
        x.id === found.id
          ? { ...x, status: found.status, followUpDate: found.followUpDate, bdNotes: found.bdNotes, updatedAt: found.updatedAt }
          : x
      )
      const notification = {
        id: genId('notif'),
        message: `🔄 Lead Update by BD\n👤 Lead: ${found.name}\n📊 Status: ${found.status}\n📝 BD Notes: ${found.bdNotes || '—'}\n📅 Follow Up: ${found.followUpDate || '—'}\n\n— ${me.businessName || me.fullName || 'BD'}`,
        sentBy: me.businessName || me.fullName || 'BD',
        sentAt: new Date().toISOString(),
        read: false,
        type: 'lead_update',
        leadId: found.id,
      }
      await persistOne('client', tcClient.id, {
        ...tcClient,
        portalLeads: updatedLeads,
        portalNotifications: [notification, ...(tcClient.portalNotifications || [])].slice(0, 100),
      })
    }
  } catch (e) {
    console.error('[BD Lead Sync]', e?.message)
  }

  res.json({ lead: found })
})

router.get('/campaigns', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ campaigns: c.portalCampaigns || [] })
})
router.post('/campaigns', async (req, res) => {
  const b = req.body || {}
  if (!b.name?.trim()) return res.status(400).json({ error: 'name is required' })
  const item = { id: genId('cmp'), name: b.name.trim(), type: b.type?.trim() || 'ad', platform: b.platform?.trim() || '', budget: b.budget?.trim() || '', status: b.status || 'draft', startDate: b.startDate || '', endDate: b.endDate || '', description: b.description?.trim() || '', createdAt: new Date().toISOString() }
  await patchClient(req, (c) => ({ ...c, portalCampaigns: [...(c.portalCampaigns || []), item] }))
  res.status(201).json({ campaign: item })
})
router.patch('/campaigns/:cid', async (req, res) => {
  const b = req.body || {}
  let found = null
  await patchClient(req, (c) => {
    const list = (c.portalCampaigns || []).map((x) => {
      if (x.id !== req.params.cid) return x
      found = { ...x, ...b, id: x.id }
      return found
    })
    return { ...c, portalCampaigns: list }
  })
  if (!found) return res.status(404).json({ error: 'Not found' })
  res.json({ campaign: found })
})
router.delete('/campaigns/:cid', async (req, res) => {
  await patchClient(req, (c) => ({ ...c, portalCampaigns: (c.portalCampaigns || []).filter((x) => x.id !== req.params.cid) }))
  res.json({ ok: true })
})

// ── Content ───────────────────────────────────────────────────────────────────
router.get('/content', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ content: c.portalContent || [] })
})
router.post('/content', async (req, res) => {
  const b = req.body || {}
  if (!b.title?.trim()) return res.status(400).json({ error: 'title is required' })
  const item = { id: genId('con'), title: b.title.trim(), type: b.type?.trim() || 'post', platform: b.platform?.trim() || '', body: b.body?.trim() || '', status: b.status || 'draft', scheduledAt: b.scheduledAt || '', tags: b.tags || [], createdAt: new Date().toISOString() }
  await patchClient(req, (c) => ({ ...c, portalContent: [...(c.portalContent || []), item] }))
  res.status(201).json({ content: item })
})
router.patch('/content/:cid', async (req, res) => {
  const b = req.body || {}
  let found = null
  await patchClient(req, (c) => {
    const list = (c.portalContent || []).map((x) => {
      if (x.id !== req.params.cid) return x
      found = { ...x, ...b, id: x.id }
      return found
    })
    return { ...c, portalContent: list }
  })
  if (!found) return res.status(404).json({ error: 'Not found' })
  res.json({ content: found })
})
router.delete('/content/:cid', async (req, res) => {
  await patchClient(req, (c) => ({ ...c, portalContent: (c.portalContent || []).filter((x) => x.id !== req.params.cid) }))
  res.json({ ok: true })
})

// ── Reels ─────────────────────────────────────────────────────────────────────
router.get('/reels', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ reels: c.portalReels || [] })
})
router.post('/reels', async (req, res) => {
  const b = req.body || {}
  if (!b.title?.trim()) return res.status(400).json({ error: 'title is required' })
  const item = { id: genId('rel'), title: b.title.trim(), platform: b.platform?.trim() || 'Instagram', duration: b.duration?.trim() || '', url: b.url?.trim() || '', key: b.key?.trim() || '', caption: b.caption?.trim() || '', status: b.status || 'draft', views: 0, likes: 0, scheduledAt: b.scheduledAt || '', createdAt: new Date().toISOString() }
  await patchClient(req, (c) => ({ ...c, portalReels: [...(c.portalReels || []), item] }))
  res.status(201).json({ reel: item })
})
router.patch('/reels/:rid', async (req, res) => {
  const b = req.body || {}
  let found = null
  await patchClient(req, (c) => {
    const list = (c.portalReels || []).map((x) => {
      if (x.id !== req.params.rid) return x
      found = { ...x, ...b, id: x.id }
      return found
    })
    return { ...c, portalReels: list }
  })
  if (!found) return res.status(404).json({ error: 'Not found' })
  res.json({ reel: found })
})
router.delete('/reels/:rid', async (req, res) => {
  await patchClient(req, (c) => ({ ...c, portalReels: (c.portalReels || []).filter((x) => x.id !== req.params.rid) }))
  res.json({ ok: true })
})

// ── Ailocity TC: BD assignees (same admin) ────────────────────────────────────
router.get('/tc-bd-assignees', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  const { clients } = await getState()
  const { getBdUsers } = require('../store')
  const bdClients = clients.filter((x) => x.adminId === c.adminId && x.appId === 'ailocity-bd')
  const assignees = []
  for (const bdClient of bdClients) {
    const bdUsers = await getBdUsers(bdClient.id)
    for (const u of bdUsers) {
      assignees.push({
        id: u.id,
        bdClientId: bdClient.id,
        name: u.fullName || '',
        email: u.email || '',
        mobile: u.mobile || '',
        role: u.role || 'bd user',
      })
    }
  }
  res.json({ assignees })
})

// ── Meetings (TC) ────────────────────────────────────────────────────────────
const MEETING_STATUS = ['pending', 'completed', 'cancelled']
const MEETING_OUTCOME = ['waiting', 'positive', 'negative', 'neutral']
const DISPOSITION = ['hot', 'warm', 'cancelled']

router.get('/meetings', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ meetings: c.portalMeetings || [] })
})

// GET meetings where this client is the invited client contact
router.get('/my-meetings', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  const { clients } = await getState()

  // Build a set of all contact IDs belonging to this client
  // Search across ALL clients since sub-clients may have different adminId
  const myContactIds = new Set()
  for (const cl of clients) {
    for (const contact of (cl.portalContacts || [])) {
      if (
        contact.refClientId === c.id ||
        (contact.email && contact.email.toLowerCase() === c.email.toLowerCase())
      ) {
        myContactIds.add(contact.id)
        if (contact.businessId) myContactIds.add(contact.businessId)
      }
    }
  }

  // Collect meetings where:
  // 1. clientContactId or serverContactId is in myContactIds
  // 2. clientName/serverName matches fullName (fallback when contactId not set)
  // 3. contactNumber matches mobile (last resort fallback)
  const myNameLower   = (c.fullName || c.businessName || '').toLowerCase().trim()
  const myMobileTrim  = (c.mobile || '').trim()
  const meetings = []
  const seen = new Set()
  for (const cl of clients) {
    for (const m of (cl.portalMeetings || [])) {
      if (seen.has(m.id)) continue
      const byClientId = m.clientContactId && myContactIds.has(m.clientContactId)
      const byServerId = m.serverContactId && myContactIds.has(m.serverContactId)
      const byClientName = !m.clientContactId && myNameLower && (m.clientName || '').toLowerCase().trim() === myNameLower
      const byServerName = !m.serverContactId && myNameLower && (m.serverName || '').toLowerCase().trim() === myNameLower
      const byMobile     = myMobileTrim && (m.contactNumber || '').trim() === myMobileTrim
      if (byClientId || byServerId || byClientName || byServerName || byMobile) {
        seen.add(m.id)
        meetings.push(m)
      }
    }
  }
  meetings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  res.json({ meetings })
})

router.post('/meetings', async (req, res) => {
  const b = req.body || {}
  if (!b.agenda?.trim()) return res.status(400).json({ error: 'agenda is required' })
  if (!b.scheduledAt?.trim()) return res.status(400).json({ error: 'scheduledAt is required' })
  const status = String(b.status || 'pending').toLowerCase()
  const outcome = String(b.outcome || 'waiting').toLowerCase()
  const disposition = String(b.disposition || 'warm').toLowerCase()
  if (!MEETING_STATUS.includes(status)) return res.status(400).json({ error: `status must be one of: ${MEETING_STATUS.join(', ')}` })
  if (!MEETING_OUTCOME.includes(outcome)) return res.status(400).json({ error: `outcome must be one of: ${MEETING_OUTCOME.join(', ')}` })
  if (!DISPOSITION.includes(disposition)) return res.status(400).json({ error: `disposition must be one of: ${DISPOSITION.join(', ')}` })
  const now = new Date().toISOString()
  const item = {
    id: genId('mtg'),
    serverContactId: String(b.serverContactId || '').trim(),
    serverName: String(b.serverName || '').trim(),
    clientContactId: String(b.clientContactId || '').trim(),
    clientName: String(b.clientName || '').trim(),
    assignBdId: String(b.assignBdId || '').trim(),
    assignBdName: String(b.assignBdName || '').trim(),
    agenda: b.agenda.trim(),
    scheduledAt: b.scheduledAt.trim(),
    disposition,
    contactPerson: String(b.contactPerson || '').trim(),
    contactNumber: String(b.contactNumber || '').trim(),
    noteForBd: String(b.noteForBd || '').trim(),
    status,
    outcome,
    createdAt: now,
    updatedAt: now,
  }
  await patchClient(req, (cl) => ({ ...cl, portalMeetings: [...(cl.portalMeetings || []), item] }))

  // Send email notifications
  try {
    const { clients } = await getState()
    const tc = await myClient(req)
    const fmtDt = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

    // Merge contacts for TC portal; ensure every entry has both `id` and `businessId`
    let rawContacts = tc?.portalContacts || []
    if (tc?.appId === 'ailocity-tc') {
      rawContacts = tcMergedContacts(tc, clients)
    }
    // Ensure businessId is always set (mirrors GET /contacts response)
    const allContacts = rawContacts.map(x => ({ ...x, businessId: x.businessId || x.id }))

    console.log('[Meeting Email] allContacts count:', allContacts.length)
    console.log('[Meeting Email] clientContactId:', item.clientContactId)
    console.log('[Meeting Email] serverContactId:', item.serverContactId)
    console.log('[Meeting Email] assignBdId:', item.assignBdId)
    if (allContacts.length > 0) {
      console.log('[Meeting Email] Sample contact ids:', allContacts.slice(0,3).map(x => x.id + '|' + x.businessId + '|' + x.email))
    }

    const commonRows = [
      ['Agenda',         item.agenda],
      ['Scheduled At',   fmtDt(item.scheduledAt)],
      ['Server',         item.serverName || '—'],
      ['Client',         item.clientName || '—'],
      ['BD Assigned',    item.assignBdName || '—'],
      ['Disposition',    item.disposition],
      ['Contact Person', item.contactPerson || '—'],
      ['Contact No.',    item.contactNumber || '—'],
      ['Status',         item.status],
      ['Outcome',        item.outcome],
    ]

    const notifyServer = b.notifyServer !== false
    const notifyClient = b.notifyClient !== false
    const notifyBd     = b.notifyBd     !== false

    console.log('[Meeting Email] notifyServer:', notifyServer, '| serverContactId:', item.serverContactId)
    console.log('[Meeting Email] notifyClient:', notifyClient, '| clientContactId:', item.clientContactId)
    console.log('[Meeting Email] notifyBd:', notifyBd, '| assignBdId:', item.assignBdId)
    console.log('[Meeting Email] allContacts count:', allContacts.length)

    // Email to server contact
    if (notifyServer && item.serverContactId) {
      const contact = allContacts.find(x => x.id === item.serverContactId || x.businessId === item.serverContactId)
      console.log('[Meeting Email] Server contact found:', contact?.name, '| email:', contact?.email)
      if (contact?.email) {
        await sendMeetingEmail({
          to: contact.email,
          toName: contact.name,
          subject: `Meeting Scheduled: ${item.agenda}`,
          html: meetingEmailHtml({ title: 'New Meeting — You are invited as Server', rows: commonRows, note: '' }),
        })
      }
    }

    // Email to client contact
    if (notifyClient && item.clientContactId) {
      const contact = allContacts.find(x => x.id === item.clientContactId || x.businessId === item.clientContactId)
      console.log('[Meeting Email] Client contact found:', contact?.name, '| email:', contact?.email)
      if (contact?.email) {
        await sendMeetingEmail({
          to: contact.email,
          toName: contact.name,
          subject: `Meeting Scheduled: ${item.agenda}`,
          html: meetingEmailHtml({ title: 'New Meeting — You are invited as Client', rows: commonRows, note: '' }),
        })
      }
    }

    // Email to BD
    if (notifyBd && item.assignBdId) {
      // assignBdId is either a BD client id or a BD user id (BDU_ prefix)
      const { getBdUsers } = require('../store')
      let bdEmail = null
      let bdName = null
      if (item.assignBdId.startsWith('BDU_')) {
        // BD user — search across all BD clients
        const bdClients = clients.filter(x => x.appId === 'ailocity-bd')
        for (const bdCl of bdClients) {
          const bdUsers = await getBdUsers(bdCl.id)
          const bdUser = bdUsers.find(u => u.id === item.assignBdId)
          if (bdUser) { bdEmail = bdUser.email; bdName = bdUser.fullName; break }
        }
      } else {
        // BD client
        const bdClient = clients.find(x => x.id === item.assignBdId)
        bdEmail = bdClient?.email
        bdName = bdClient?.businessName || bdClient?.fullName
      }
      console.log('[Meeting Email] BD assignee found:', bdName, '| email:', bdEmail)
      if (bdEmail) {
        await sendMeetingEmail({
          to: bdEmail,
          toName: bdName,
          subject: `Meeting Assigned: ${item.agenda}`,
          html: meetingEmailHtml({ title: 'Meeting Assigned to You', rows: commonRows, note: item.noteForBd }),
        })
      }
    }
  } catch (emailErr) {
    console.error('[Meeting Email] Error:', emailErr?.message)
  }

  res.status(201).json({ meeting: item })
})

router.patch('/meetings/:mid', async (req, res) => {
  const b = req.body || {}
  let found = null
  await patchClient(req, (cl) => {
    const list = (cl.portalMeetings || []).map((x) => {
      if (x.id !== req.params.mid) return x
      const status = b.status != null ? String(b.status).toLowerCase() : x.status
      const outcome = b.outcome != null ? String(b.outcome).toLowerCase() : x.outcome
      const disposition = b.disposition != null ? String(b.disposition).toLowerCase() : x.disposition
      if (b.status != null && !MEETING_STATUS.includes(status)) return x
      if (b.outcome != null && !MEETING_OUTCOME.includes(outcome)) return x
      if (b.disposition != null && !DISPOSITION.includes(disposition)) return x
      found = {
        ...x,
        ...(b.serverContactId !== undefined ? { serverContactId: String(b.serverContactId).trim() } : {}),
        ...(b.serverName !== undefined ? { serverName: String(b.serverName).trim() } : {}),
        ...(b.clientContactId !== undefined ? { clientContactId: String(b.clientContactId).trim() } : {}),
        ...(b.clientName !== undefined ? { clientName: String(b.clientName).trim() } : {}),
        ...(b.assignBdId !== undefined ? { assignBdId: String(b.assignBdId).trim() } : {}),
        ...(b.assignBdName !== undefined ? { assignBdName: String(b.assignBdName).trim() } : {}),
        ...(b.agenda?.trim() ? { agenda: b.agenda.trim() } : {}),
        ...(b.scheduledAt?.trim() ? { scheduledAt: b.scheduledAt.trim() } : {}),
        ...(b.contactPerson !== undefined ? { contactPerson: String(b.contactPerson).trim() } : {}),
        ...(b.contactNumber !== undefined ? { contactNumber: String(b.contactNumber).trim() } : {}),
        ...(b.noteForBd !== undefined ? { noteForBd: String(b.noteForBd).trim() } : {}),
        ...(b.status != null ? { status } : {}),
        ...(b.outcome != null ? { outcome } : {}),
        ...(b.disposition != null ? { disposition } : {}),
        updatedAt: new Date().toISOString(),
      }
      return found
    })
    return { ...cl, portalMeetings: list }
  })
  if (!found) return res.status(404).json({ error: 'Meeting not found' })
  res.json({ meeting: found })
})

router.delete('/meetings/:mid', async (req, res) => {
  let ok = false
  await patchClient(req, (cl) => {
    const next = (cl.portalMeetings || []).filter((x) => x.id !== req.params.mid)
    ok = next.length !== (cl.portalMeetings || []).length
    return { ...cl, portalMeetings: next }
  })
  if (!ok) return res.status(404).json({ error: 'Meeting not found' })
  res.json({ ok: true })
})

// ── MyDial: dial reports ──────────────────────────────────────────────────────
router.get('/dial-reports', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ reports: c.portalDialReports || [] })
})

router.post('/dial-reports', async (req, res) => {
  const b = req.body || {}
  if (!b.title?.trim()) return res.status(400).json({ error: 'title is required' })
  const item = {
    id: genId('drep'),
    title: b.title.trim(),
    summary: String(b.summary || '').trim(),
    notes: String(b.notes || '').trim(),
    periodLabel: String(b.periodLabel || '').trim(),
    createdAt: new Date().toISOString(),
  }
  await patchClient(req, (cl) => ({ ...cl, portalDialReports: [...(cl.portalDialReports || []), item] }))
  res.status(201).json({ report: item })
})

router.patch('/dial-reports/:rid', async (req, res) => {
  const b = req.body || {}
  let found = null
  await patchClient(req, (cl) => {
    const list = (cl.portalDialReports || []).map((x) => {
      if (x.id !== req.params.rid) return x
      found = {
        ...x,
        ...(b.title?.trim() ? { title: b.title.trim() } : {}),
        ...(b.summary !== undefined ? { summary: String(b.summary).trim() } : {}),
        ...(b.notes !== undefined ? { notes: String(b.notes).trim() } : {}),
        ...(b.periodLabel !== undefined ? { periodLabel: String(b.periodLabel).trim() } : {}),
      }
      return found
    })
    return { ...cl, portalDialReports: list }
  })
  if (!found) return res.status(404).json({ error: 'Report not found' })
  res.json({ report: found })
})

router.delete('/dial-reports/:rid', async (req, res) => {
  let ok = false
  await patchClient(req, (cl) => {
    const next = (cl.portalDialReports || []).filter((x) => x.id !== req.params.rid)
    ok = next.length !== (cl.portalDialReports || []).length
    return { ...cl, portalDialReports: next }
  })
  if (!ok) return res.status(404).json({ error: 'Report not found' })
  res.json({ ok: true })
})

// ── MyDial: dial calls log ────────────────────────────────────────────────────
router.get('/dial-calls', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ calls: c.portalDialCalls || [] })
})

router.post('/dial-calls', async (req, res) => {
  const b = req.body || {}
  if (!b.partyName?.trim()) return res.status(400).json({ error: 'partyName is required' })
  const item = {
    id: genId('dcl'),
    partyName: b.partyName.trim(),
    phone: String(b.phone || '').trim(),
    durationSec: Number.isFinite(Number(b.durationSec)) ? Number(b.durationSec) : 0,
    disposition: String(b.disposition || '').trim(),
    notes: String(b.notes || '').trim(),
    createdAt: new Date().toISOString(),
  }
  await patchClient(req, (cl) => ({ ...cl, portalDialCalls: [...(cl.portalDialCalls || []), item] }))
  res.status(201).json({ call: item })
})

router.patch('/dial-calls/:cid', async (req, res) => {
  const b = req.body || {}
  let found = null
  await patchClient(req, (cl) => {
    const list = (cl.portalDialCalls || []).map((x) => {
      if (x.id !== req.params.cid) return x
      found = {
        ...x,
        ...(b.partyName?.trim() ? { partyName: b.partyName.trim() } : {}),
        ...(b.phone !== undefined ? { phone: String(b.phone).trim() } : {}),
        ...(b.durationSec !== undefined ? { durationSec: Number.isFinite(Number(b.durationSec)) ? Number(b.durationSec) : x.durationSec } : {}),
        ...(b.disposition !== undefined ? { disposition: String(b.disposition).trim() } : {}),
        ...(b.notes !== undefined ? { notes: String(b.notes).trim() } : {}),
      }
      return found
    })
    return { ...cl, portalDialCalls: list }
  })
  if (!found) return res.status(404).json({ error: 'Call not found' })
  res.json({ call: found })
})

router.delete('/dial-calls/:cid', async (req, res) => {
  let ok = false
  await patchClient(req, (cl) => {
    const next = (cl.portalDialCalls || []).filter((x) => x.id !== req.params.cid)
    ok = next.length !== (cl.portalDialCalls || []).length
    return { ...cl, portalDialCalls: next }
  })
  if (!ok) return res.status(404).json({ error: 'Call not found' })
  res.json({ ok: true })
})

// ── TC trainings ─────────────────────────────────────────────────────────────
router.get('/tc-trainings', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ trainings: c.portalTcTrainings || [] })
})

router.post('/tc-trainings', async (req, res) => {
  const b = req.body || {}
  if (!b.title?.trim()) return res.status(400).json({ error: 'title is required' })
  const now = new Date().toISOString()
  const item = {
    id: genId('tctr'),
    title: b.title.trim(),
    module: String(b.module || '').trim(),
    status: String(b.status || 'pending').toLowerCase(),
    notes: String(b.notes || '').trim(),
    scheduledAt: String(b.scheduledAt || '').trim(),
    createdAt: now,
    updatedAt: now,
  }
  await patchClient(req, (cl) => ({ ...cl, portalTcTrainings: [...(cl.portalTcTrainings || []), item] }))
  res.status(201).json({ training: item })
})

router.patch('/tc-trainings/:tid', async (req, res) => {
  const b = req.body || {}
  let found = null
  await patchClient(req, (cl) => {
    const list = (cl.portalTcTrainings || []).map((x) => {
      if (x.id !== req.params.tid) return x
      found = {
        ...x,
        ...(b.title?.trim() ? { title: b.title.trim() } : {}),
        ...(b.module !== undefined ? { module: String(b.module).trim() } : {}),
        ...(b.status !== undefined ? { status: String(b.status).toLowerCase().trim() } : {}),
        ...(b.notes !== undefined ? { notes: String(b.notes).trim() } : {}),
        ...(b.scheduledAt !== undefined ? { scheduledAt: String(b.scheduledAt).trim() } : {}),
        updatedAt: new Date().toISOString(),
      }
      return found
    })
    return { ...cl, portalTcTrainings: list }
  })
  if (!found) return res.status(404).json({ error: 'Training not found' })
  res.json({ training: found })
})

router.delete('/tc-trainings/:tid', async (req, res) => {
  let ok = false
  await patchClient(req, (cl) => {
    const next = (cl.portalTcTrainings || []).filter((x) => x.id !== req.params.tid)
    ok = next.length !== (cl.portalTcTrainings || []).length
    return { ...cl, portalTcTrainings: next }
  })
  if (!ok) return res.status(404).json({ error: 'Training not found' })
  res.json({ ok: true })
})

// ── AI Calls (inbound / outbound) ─────────────────────────────────────────────
const AI_CALL_DIR = ['inbound', 'outbound']

router.get('/ai-calls', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ calls: c.portalAICalls || [] })
})

router.post('/ai-calls', async (req, res) => {
  const b = req.body || {}
  const direction = String(b.direction || '').toLowerCase()
  if (!AI_CALL_DIR.includes(direction)) return res.status(400).json({ error: 'direction must be inbound or outbound' })
  const now = new Date().toISOString()
  const item = {
    id: genId('aic'),
    direction,
    party: String(b.party || '').trim(),
    phone: String(b.phone || '').trim(),
    durationSec: Number.isFinite(Number(b.durationSec)) ? Number(b.durationSec) : 0,
    outcome: String(b.outcome || '').trim(),
    notes: String(b.notes || '').trim(),
    status: String(b.status || 'completed').trim(),
    createdAt: now,
    updatedAt: now,
  }
  await patchClient(req, (cl) => ({ ...cl, portalAICalls: [...(cl.portalAICalls || []), item] }))
  res.status(201).json({ call: item })
})

router.patch('/ai-calls/:aid', async (req, res) => {
  const b = req.body || {}
  let found = null
  await patchClient(req, (cl) => {
    const list = (cl.portalAICalls || []).map((x) => {
      if (x.id !== req.params.aid) return x
      const direction = b.direction != null ? String(b.direction).toLowerCase() : x.direction
      if (b.direction != null && !AI_CALL_DIR.includes(direction)) return x
      found = {
        ...x,
        ...(b.direction != null ? { direction } : {}),
        ...(b.party !== undefined ? { party: String(b.party).trim() } : {}),
        ...(b.phone !== undefined ? { phone: String(b.phone).trim() } : {}),
        ...(b.durationSec !== undefined ? { durationSec: Number.isFinite(Number(b.durationSec)) ? Number(b.durationSec) : x.durationSec } : {}),
        ...(b.outcome !== undefined ? { outcome: String(b.outcome).trim() } : {}),
        ...(b.notes !== undefined ? { notes: String(b.notes).trim() } : {}),
        ...(b.status !== undefined ? { status: String(b.status).trim() } : {}),
        updatedAt: new Date().toISOString(),
      }
      return found
    })
    return { ...cl, portalAICalls: list }
  })
  if (!found) return res.status(404).json({ error: 'AI call not found' })
  res.json({ call: found })
})

router.delete('/ai-calls/:aid', async (req, res) => {
  let ok = false
  await patchClient(req, (cl) => {
    const next = (cl.portalAICalls || []).filter((x) => x.id !== req.params.aid)
    ok = next.length !== (cl.portalAICalls || []).length
    return { ...cl, portalAICalls: next }
  })
  if (!ok) return res.status(404).json({ error: 'AI call not found' })
  res.json({ ok: true })
})

// ── AI Auto-fill for Add Business form ───────────────────────────────────────
router.post('/ai-fill', async (req, res) => {
  const { prompt } = req.body || {}
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' })
  const categoryList = Object.keys(CATEGORY_MAP).join(', ')
  const subCatList = JSON.stringify(CATEGORY_MAP)
  const systemPrompt = `You are an intelligent business data assistant for an Indian CRM system.
Your job is to EXTRACT facts from the user input AND ALSO INTELLIGENTLY INFER missing fields based on context, common knowledge, and business type.

RULES:
- Extract every detail explicitly mentioned.
- For fields NOT mentioned, use your knowledge to make a smart best-guess inference. For example:
  - If business is a "pharmacy" in "Mumbai", infer state = "Maharashtra", country = "India", category = "Healthcare", subCategory = "Pharmacy", businessType = "Proprietorship" (most common for pharmacies).
  - If a website is given, infer websiteUrl.
  - If business sounds like a startup IT company, infer mbcSubCategory = "Startup - Inhouse" or "Startup - Outside".
  - If city is known, infer the state.
  - Always infer "notes" as a 1-2 sentence professional business description.
- NEVER leave a field empty if you can reasonably infer it.
- For "type": use "server" if the business provides services/products to other businesses, otherwise "client".

VALID VALUES:
- category: ${categoryList}
- subCategory per category: ${subCatList}
- businessType: Proprietorship, Partnership, Pvt Ltd, LLP, Other
- type: client, server
- mbcSubCategory: Startup - Inhouse, Startup - Outside, MSME, Big Enterprise, PSU, Others
- status: active
- country: India (default)

Return ONLY this JSON with no extra text, no markdown, no explanation:
{"name":"","company":"","businessType":"","category":"","subCategory":"","email":"","mobile":"","alternateMobile":"","websiteUrl":"","gstNumber":"","panNumber":"","address":"","city":"","state":"","pincode":"","country":"India","instagramUrl":"","facebookUrl":"","youtubeUrl":"","type":"client","mbcSubCategory":"","status":"active","notes":""}`
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt.trim() },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    })
    const text = completion.choices[0]?.message?.content || '{}'
    const jsonMatch = text.match(/{[\s\S]*}/)
    if (!jsonMatch) return res.status(422).json({ error: 'Could not parse AI response' })
    const data = JSON.parse(jsonMatch[0])
    res.json({ data })
  } catch (err) {
    console.error('[AI Fill]', err?.message)
    res.status(500).json({ error: err?.message || 'AI fill failed' })
  }
})

// ── Telegram: send alert + save notification for all same-admin clients ──────
router.post('/telegram/send-alert', async (req, res) => {
  const { message } = req.body || {}
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' })
  const tc = await myClient(req)
  if (!tc) return res.status(404).json({ error: 'Client not found' })

  const botToken = tc.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || ''
  const chatId   = tc.telegramChatId   || process.env.TELEGRAM_CHAT_ID   || ''

  let telegramOk = false
  let telegramError = null
  if (botToken && chatId) {
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
      })
      const tgData = await tgRes.json()
      console.log('[Telegram Send] response:', JSON.stringify(tgData))
      telegramOk = tgData.ok === true
      if (!telegramOk) telegramError = tgData.description || 'Unknown Telegram error'
    } catch (e) {
      console.error('[Telegram Send] fetch error:', e?.message)
      telegramError = e?.message
    }
  } else {
    telegramError = `Missing config — botToken: ${!!botToken}, chatId: ${!!chatId}`
    console.warn('[Telegram Send]', telegramError)
  }

  const { clients } = await getState()
  const notification = {
    id: genId('notif'),
    message: message.trim(),
    sentBy: tc.businessName || tc.fullName || 'TC',
    sentAt: new Date().toISOString(),
    read: false,
  }
  // Notify all clients across the entire system (not just same adminId)
  // because TC, Business, BD may have different adminIds in some setups
  // Exclude TC clients — lead assign notifications should not go to TC
  const targetClients = clients.filter(
    (c) => c.id !== tc.id &&
    c.appId !== 'ailocity-tc' &&
    ['ailocity', 'ailocity-business', 'ailocity-bd'].includes(c.appId)
  )
  await Promise.all(
    targetClients.map((c) =>
      persistOne('client', c.id, {
        ...c,
        portalNotifications: [notification, ...(c.portalNotifications || [])].slice(0, 100),
      })
    )
  )
  res.json({ ok: true, telegramOk, telegramError, notifiedCount: targetClients.length })
})

// ── Notifications: fetch + mark read ─────────────────────────────────────────
router.get('/notifications', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ notifications: c.portalNotifications || [] })
})

router.patch('/notifications/read-all', async (req, res) => {
  await patchClient(req, (c) => ({
    ...c,
    portalNotifications: (c.portalNotifications || []).map((n) => ({ ...n, read: true })),
  }))
  res.json({ ok: true })
})

// ── Telegram Alert Settings ──────────────────────────────────────────────────
router.get('/telegram/settings', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({
    botToken: c.telegramBotToken || '',
    chatId: c.telegramChatId || '',
  })
})

router.post('/telegram/settings', async (req, res) => {
  const { botToken, chatId } = req.body || {}
  if (!botToken?.trim() || !chatId?.trim())
    return res.status(400).json({ error: 'botToken and chatId are required' })
  await patchClient(req, (c) => ({
    ...c,
    telegramBotToken: botToken.trim(),
    telegramChatId: chatId.trim(),
  }))
  res.json({ ok: true })
})

module.exports = router
