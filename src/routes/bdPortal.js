const express = require('express')
const bcrypt  = require('bcryptjs')
const multer  = require('multer')
const { getState, genId, getBdUsers, persistBdUser, deleteBdUser } = require('../store')
const { requireAuth } = require('../middleware/requireAuth')
const { uploadToR2, getPresignedUrl } = require('../r2')

const router = express.Router()
router.use(requireAuth('bd'))

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// ── Helpers ──────────────────────────────────────────────────────────────────

async function myBDClient(req) {
  const { clients } = await getState()
  return clients.find((c) => c.id === req.user.sub)
}

function publicUser(u) {
  return {
    id:          u.id,
    bdClientId:  u.bdClientId,
    fullName:    u.fullName,
    email:       u.email,
    mobile:      u.mobile,
    city:        u.city,
    pincode:     u.pincode,
    address:     u.address,
    imageKey:    u.imageKey,
    accountType: u.accountType,
    dob:         u.dob,
    profession:  u.profession,
    createdAt:   u.createdAt,
  }
}

// ── Upload image to R2 ───────────────────────────────────────────────────────
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

// ── Me ───────────────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  const c = await myBDClient(req)
  if (!c) return res.status(404).json({ error: 'BD client not found' })
  res.json({
    id:             c.id,
    email:          c.email,
    fullName:       c.fullName,
    businessName:   c.businessName,
    mobile:         c.mobile,
    status:         c.status,
    kyc:            c.kyc,
    creditsBalance: c.creditsBalance,
    appId:          c.appId,
  })
})

// ── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const c = await myBDClient(req)
  if (!c) return res.status(404).json({ error: 'BD client not found' })
  const users = await getBdUsers(c.id)
  res.json({
    stats: {
      totalMeetings:  0,
      trainingsDone:  0,
      agentCalls:     c.totalCalls ?? 0,
      totalEarnings:  0,
      totalUsers:     users.length,
    },
  })
})

// ── Users CRUD ───────────────────────────────────────────────────────────────

// GET all users for this BD partner
router.get('/users', async (req, res) => {
  const c = await myBDClient(req)
  if (!c) return res.status(404).json({ error: 'BD client not found' })
  const users = await getBdUsers(c.id)
  // Attach presigned image URLs
  const withUrls = await Promise.all(users.map(async (u) => {
    if (!u.imageKey) return u
    try {
      const imageUrl = await getPresignedUrl(u.imageKey)
      return { ...u, imageUrl }
    } catch {
      return u
    }
  }))
  res.json({ users: withUrls })
})

// ── Business (Client/Server contacts) ─────────────────────────────────────────
// BD dashboard "Business" tab reads portalContacts from the Ailocity Business
// client that shares the same adminId as this BD client.
router.get('/business', async (req, res) => {
  const c = await myBDClient(req)
  if (!c) return res.status(404).json({ error: 'BD client not found' })

  const { clients } = await getState()

  // Find the Ailocity Business client under the same admin.
  // Try ailocity-business appId first, then pick the client (excluding self)
  // with the most portalContacts under the same admin.
  const sameAdminClients = clients.filter(
    (x) => x.adminId === c.adminId && x.id !== c.id
  )
  const bizClient =
    sameAdminClients.find((x) => x.appId === 'ailocity-business') ||
    sameAdminClients.sort(
      (a, b) => (b.portalContacts?.length ?? 0) - (a.portalContacts?.length ?? 0)
    )[0]

  const contacts = Array.isArray(bizClient?.portalContacts)
    ? bizClient.portalContacts
    : []

  const withUrls = await Promise.all(
    contacts.map(async (x) => {
      if (!x.logoKey) return x
      try {
        const logoUrl = await getPresignedUrl(x.logoKey)
        return { ...x, logoUrl }
      } catch {
        return x
      }
    }),
  )

  res.json({ businesses: withUrls })
})

// POST create user
router.post('/users', async (req, res) => {
  const c = await myBDClient(req)
  if (!c) return res.status(404).json({ error: 'BD client not found' })

  const b = req.body || {}
  if (!b.fullName?.trim())  return res.status(400).json({ error: 'fullName is required' })
  if (!b.email?.trim())     return res.status(400).json({ error: 'email is required' })
  if (!b.mobile?.trim())    return res.status(400).json({ error: 'mobile is required' })
  if (!b.password)          return res.status(400).json({ error: 'password is required' })

  // Check duplicate email within this BD partner's users
  const existing = await getBdUsers(c.id)
  const dup = existing.some(u => u.email.toLowerCase() === b.email.trim().toLowerCase())
  if (dup) return res.status(409).json({ error: 'User with this email already exists' })

  const user = {
    id:           genId('bdu'),
    bdClientId:   c.id,
    fullName:     b.fullName.trim(),
    email:        b.email.trim().toLowerCase(),
    mobile:       b.mobile.trim(),
    city:         b.city?.trim()        || '',
    pincode:      b.pincode?.trim()     || '',
    address:      b.address?.trim()     || '',
    imageKey:     b.imageKey?.trim()    || '',
    accountType:  b.accountType        || 'New',
    dob:          b.dob                || '',
    profession:   b.profession?.trim() || '',
    passwordHash: bcrypt.hashSync(b.password, 10),
    createdAt:    new Date().toISOString(),
  }

  await persistBdUser(user)
  res.status(201).json({ user: publicUser(user) })
})

// PATCH update user
router.patch('/users/:uid', async (req, res) => {
  const c = await myBDClient(req)
  if (!c) return res.status(404).json({ error: 'BD client not found' })

  const users = await getBdUsers(c.id)
  const existing = users.find(u => u.id === req.params.uid)
  if (!existing) return res.status(404).json({ error: 'User not found' })

  const b = req.body || {}
  const updated = {
    ...existing,
    ...(b.fullName?.trim()    ? { fullName:    b.fullName.trim() }    : {}),
    ...(b.mobile?.trim()      ? { mobile:      b.mobile.trim() }      : {}),
    ...(b.city !== undefined  ? { city:        String(b.city).trim() } : {}),
    ...(b.pincode !== undefined ? { pincode:   String(b.pincode).trim() } : {}),
    ...(b.address !== undefined ? { address:   String(b.address).trim() } : {}),
    ...(b.imageKey !== undefined ? { imageKey: String(b.imageKey).trim() } : {}),
    ...(b.accountType         ? { accountType: b.accountType }        : {}),
    ...(b.dob !== undefined   ? { dob:         b.dob }                : {}),
    ...(b.profession !== undefined ? { profession: String(b.profession).trim() } : {}),
    ...(b.password            ? { passwordHash: bcrypt.hashSync(b.password, 10) } : {}),
  }

  await persistBdUser(updated)
  res.json({ user: publicUser(updated) })
})

// DELETE user
router.delete('/users/:uid', async (req, res) => {
  const c = await myBDClient(req)
  if (!c) return res.status(404).json({ error: 'BD client not found' })

  const users = await getBdUsers(c.id)
  const exists = users.some(u => u.id === req.params.uid)
  if (!exists) return res.status(404).json({ error: 'User not found' })

  await deleteBdUser(req.params.uid)
  res.json({ ok: true })
})

module.exports = router
