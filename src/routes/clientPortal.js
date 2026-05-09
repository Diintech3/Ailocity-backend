const express = require('express')
const multer = require('multer')
const bcrypt = require('bcryptjs')
const { getState, persistOne, deleteOne, genId } = require('../store')
const { requireAuth } = require('../middleware/requireAuth')
const { uploadToR2, getPresignedUrl } = require('../r2')
const { sign } = require('../auth')

const router = express.Router()
router.use(requireAuth(['app', 'business']))

// appId guard ab zaroorat nahi — role hi isolate karta hai

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
  const { clients } = await getState()
  return clients.find((c) => c.id === req.user.sub)
}

async function patchClient(req, updater) {
  const state = await getState()
  const idx = state.clients.findIndex((c) => c.id === req.user.sub)
  if (idx === -1) return null
  const updated = updater(state.clients[idx])
  await persistOne('client', updated.id, updated)
  return updated
}

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
  // Generate presigned URLs for product images
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
  
  // Return with presigned URL if image exists
  let responseItem = item
  if (item.imageKey) {
    try {
      const imageUrl = await getPresignedUrl(item.imageKey)
      responseItem = { ...item, imageUrl }
    } catch {}
  }
  
  res.status(201).json({ product: responseItem })
})

router.get('/products/:pid', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  const product = (c.portalProducts || []).find((p) => p.id === req.params.pid)
  if (!product) return res.status(404).json({ error: 'Product not found' })
  
  // Generate presigned URL for image
  let responseProduct = product
  if (product.imageKey) {
    try {
      const imageUrl = await getPresignedUrl(product.imageKey)
      responseProduct = { ...product, imageUrl }
    } catch {}
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
  
  // Return with presigned URL if image exists
  let responseProduct = found
  if (found.imageKey) {
    try {
      const imageUrl = await getPresignedUrl(found.imageKey)
      responseProduct = { ...found, imageUrl }
    } catch {}
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

// ── Contacts (Clients tab) ────────────────────────────────────────────────────
router.get('/contacts', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  const contacts = c.portalContacts || []
  const withUrls = await Promise.all(
    contacts.map(async (x) => {
      if (!x.logoKey) return x
      try {
        const logoUrl = await getPresignedUrl(x.logoKey)
        return { ...x, logoUrl }
      } catch {
        return x
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

  // If email + password provided, register as a real client
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
      }
      await persistOne('client', newClient.id, newClient)
      refClientId = newClient.id
    }
  }

  const item = {
    id: genId('cnt'),
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

  const APP_ROLE = { 'ailocity': 'app', 'ailocity-business': 'business', 'ailocity-bd': 'bd' }
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

  // If password provided and contact has no refClientId, register new client
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
      found = { ...x, ...b, id: x.id }
      delete found.password
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

  // Update contact kyc
  await patchClient(req, (c) => {
    const list = (c.portalContacts || []).map((x) => {
      if (x.id !== req.params.cid) return x
      found = { ...x, kyc }
      return found
    })
    return { ...c, portalContacts: list }
  })
  if (!found) return res.status(404).json({ error: 'Contact not found' })

  // Also update linked client's kyc if exists
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
  
  const validTypes = ['file', 'image', 'video', 'pdf', 'url', 'website', 'youtube', 'text', 'File Upload', 'Website', 'Youtube', 'URLs', 'Text', 'AI Guidelines']
  const typeNormalized = b.type.trim().toLowerCase()
  
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

// ── Leads ─────────────────────────────────────────────────────────────────────
router.get('/leads', async (req, res) => {
  const c = await myClient(req)
  if (!c) return res.status(404).json({ error: 'Client not found' })
  res.json({ leads: c.portalLeads || [] })
})
router.post('/leads', async (req, res) => {
  const b = req.body || {}
  if (!b.name?.trim()) return res.status(400).json({ error: 'name is required' })
  const item = { id: genId('ld'), name: b.name.trim(), email: b.email?.trim() || '', mobile: b.mobile?.trim() || '', source: b.source?.trim() || 'Direct', requirement: b.requirement?.trim() || '', budget: b.budget?.trim() || '', status: b.status || 'new', priority: b.priority || 'medium', createdAt: new Date().toISOString() }
  await patchClient(req, (c) => ({ ...c, portalLeads: [...(c.portalLeads || []), item] }))
  res.status(201).json({ lead: item })
})
router.patch('/leads/:lid', async (req, res) => {
  const b = req.body || {}
  let found = null
  await patchClient(req, (c) => {
    const list = (c.portalLeads || []).map((x) => {
      if (x.id !== req.params.lid) return x
      found = { ...x, ...b, id: x.id }
      return found
    })
    return { ...c, portalLeads: list }
  })
  if (!found) return res.status(404).json({ error: 'Not found' })
  res.json({ lead: found })
})
router.delete('/leads/:lid', async (req, res) => {
  await patchClient(req, (c) => ({ ...c, portalLeads: (c.portalLeads || []).filter((x) => x.id !== req.params.lid) }))
  res.json({ ok: true })
})

// ── Campaigns ─────────────────────────────────────────────────────────────────
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

module.exports = router
