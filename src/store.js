const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')
const { App, Admin, Client, BdUser } = require('./models')
const log = require('./logger')

const defaultApps = [
  { id: 'ailocity', name: 'Ailocity' },
  { id: 'ailocity-bd', name: 'Ailocity BD' },
  { id: 'ailocity-business', name: 'Ailocity Business' },
]

const JSON_LEGACY_PATH = path.join(__dirname, '..', 'data', 'db.json')

function docToAdmin(doc) {
  if (!doc) return null
  const a = doc.toObject ? doc.toObject() : doc
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    passwordHash: a.passwordHash,
    status: a.status,
    createdAt: a.createdAt,
    bootstrapFromEnv: Boolean(a.bootstrapFromEnv),
  }
}

function docToClient(doc) {
  if (!doc) return null
  const c = doc.toObject ? doc.toObject() : doc
  return {
    id: c.id,
    adminId: c.adminId,
    appId: c.appId,
    fullName: c.fullName,
    email: c.email,
    passwordHash: c.passwordHash,
    businessName: c.businessName,
    businessLogoKey: c.businessLogoKey ?? '',
    websiteUrl: c.websiteUrl ?? '',
    gstNumber: c.gstNumber ?? '',
    panNumber: c.panNumber ?? '',
    mobile: c.mobile,
    address: c.address ?? '',
    city: c.city ?? '',
    pincode: c.pincode ?? '',
    status: c.status,
    kyc: c.kyc,
    source: c.source ?? 'Direct',
    owner: c.owner ?? 'Owner',
    agents: c.agents ?? 0,
    creditsBalance: c.creditsBalance ?? 0,
    totalCalls: c.totalCalls ?? 0,
    activeAgentsCount: c.activeAgentsCount ?? 0,
    createdAt: c.createdAt,
    portalAgents: Array.isArray(c.portalAgents) ? c.portalAgents : [],
    portalTickets: Array.isArray(c.portalTickets) ? c.portalTickets : [],
    usageStats: Array.isArray(c.usageStats) ? c.usageStats : [],
    portalServices: Array.isArray(c.portalServices) ? c.portalServices : [],
    portalProducts: Array.isArray(c.portalProducts) ? c.portalProducts : [],
    portalContacts: Array.isArray(c.portalContacts) ? c.portalContacts : [],
    portalDataStore: Array.isArray(c.portalDataStore) ? c.portalDataStore : [],
    portalLeads: Array.isArray(c.portalLeads) ? c.portalLeads : [],
    portalCampaigns: Array.isArray(c.portalCampaigns) ? c.portalCampaigns : [],
    portalContent: Array.isArray(c.portalContent) ? c.portalContent : [],
    portalReels: Array.isArray(c.portalReels) ? c.portalReels : [],
  }
}

async function connectMongo() {
  const uri = (process.env.MONGODB_URI || '').trim()
  if (!uri) {
    throw new Error('MONGODB_URI is not set')
  }
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 60000,
    maxPoolSize: 10,
    minPoolSize: 2,
    heartbeatFrequencyMS: 10000,
  })
  log.info('Database connection established')
}

async function getState() {
  const [apps, adminDocs, clientDocs] = await Promise.all([
    App.find().lean(),
    Admin.find().lean(),
    Client.find().lean(),
  ])
  return {
    apps: apps.map((a) => ({ id: a.id, name: a.name })),
    admins: adminDocs.map(docToAdmin),
    clients: clientDocs.map(docToClient),
  }
}

function toAdminInsert(a) {
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    passwordHash: a.passwordHash,
    status: a.status,
    createdAt: a.createdAt,
    bootstrapFromEnv: Boolean(a.bootstrapFromEnv),
  }
}

function toClientInsert(c) {
  return {
    id: c.id,
    adminId: c.adminId,
    appId: c.appId,
    fullName: c.fullName,
    email: c.email,
    passwordHash: c.passwordHash,
    businessName: c.businessName,
    businessLogoKey: c.businessLogoKey ?? '',
    websiteUrl: c.websiteUrl ?? '',
    gstNumber: c.gstNumber ?? '',
    panNumber: c.panNumber ?? '',
    mobile: c.mobile,
    address: c.address ?? '',
    city: c.city ?? '',
    pincode: c.pincode ?? '',
    status: c.status,
    kyc: c.kyc,
    source: c.source ?? 'Direct',
    owner: c.owner ?? 'Owner',
    agents: c.agents ?? 0,
    creditsBalance: c.creditsBalance ?? 0,
    totalCalls: c.totalCalls ?? 0,
    activeAgentsCount: c.activeAgentsCount ?? 0,
    createdAt: c.createdAt,
    portalAgents: c.portalAgents || [],
    portalTickets: c.portalTickets || [],
    usageStats: c.usageStats || [],
    portalServices: c.portalServices || [],
    portalProducts: c.portalProducts || [],
    portalContacts: c.portalContacts || [],
    portalDataStore: c.portalDataStore || [],
    portalLeads: c.portalLeads || [],
    portalCampaigns: c.portalCampaigns || [],
    portalContent: c.portalContent || [],
    portalReels: c.portalReels || [],
  }
}

async function persist(next) {
  const apps = next.apps || []
  const admins = next.admins || []
  const clients = next.clients || []

  await Promise.all([
    ...apps.map((a) => App.findOneAndUpdate({ id: a.id }, { id: a.id, name: a.name }, { upsert: true })),
    ...admins.map((a) => Admin.findOneAndUpdate({ id: a.id }, toAdminInsert(a), { upsert: true })),
    ...clients.map((c) => Client.findOneAndUpdate({ id: c.id }, toClientInsert(c), { upsert: true, setDefaultsOnInsert: true })),
  ])
}

async function persistOne(collection, id, data) {
  if (collection === 'client') {
    await Client.findOneAndUpdate({ id }, toClientInsert(data), { upsert: true, setDefaultsOnInsert: true })
  } else if (collection === 'admin') {
    await Admin.findOneAndUpdate({ id }, toAdminInsert(data), { upsert: true })
  } else if (collection === 'app') {
    await App.findOneAndUpdate({ id }, { id: data.id, name: data.name }, { upsert: true })
  }
}

async function deleteOne(collection, id) {
  if (collection === 'client') await Client.deleteOne({ id })
  else if (collection === 'admin') await Admin.deleteOne({ id })
  else if (collection === 'app') await App.deleteOne({ id })
  else if (collection === 'bduser') await BdUser.deleteOne({ id })
}

// ── BdUser CRUD ──────────────────────────────────────────────────────────────

function docToBdUser(doc) {
  if (!doc) return null
  const u = doc.toObject ? doc.toObject() : doc
  return {
    id:          u.id,
    bdClientId:  u.bdClientId,
    fullName:    u.fullName,
    email:       u.email,
    mobile:      u.mobile,
    city:        u.city        ?? '',
    pincode:     u.pincode     ?? '',
    address:     u.address     ?? '',
    imageKey:    u.imageKey    ?? '',
    accountType: u.accountType ?? 'New',
    dob:         u.dob         ?? '',
    profession:  u.profession  ?? '',
    passwordHash:u.passwordHash,
    createdAt:   u.createdAt,
  }
}

async function getBdUsers(bdClientId) {
  const docs = await BdUser.find({ bdClientId }).lean()
  return docs.map(docToBdUser)
}

async function persistBdUser(data) {
  await BdUser.findOneAndUpdate(
    { id: data.id },
    data,
    { upsert: true, setDefaultsOnInsert: true }
  )
}

async function deleteBdUser(id) {
  await BdUser.deleteOne({ id })
}

function genId(prefix) {
  const upper = prefix.toUpperCase()
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${upper}_${rand}`
}

async function migrateFromLegacyJsonIfEmpty() {
  const count = await App.countDocuments()
  if (count > 0) return false
  if (!fs.existsSync(JSON_LEGACY_PATH)) return false
  try {
    const raw = fs.readFileSync(JSON_LEGACY_PATH, 'utf8')
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return false
    const apps = Array.isArray(data.apps) && data.apps.length ? data.apps : [...defaultApps]
    const admins = Array.isArray(data.admins) ? data.admins : []
    const clients = Array.isArray(data.clients) ? data.clients : []
    await persist({ apps, admins, clients })
    log.info('Legacy data file imported', { source: 'data/db.json' })
    return true
  } catch (e) {
    log.warn('Legacy import failed', { error: e.message })
    return false
  }
}

async function seedDefaultAppsIfEmpty() {
  const count = await App.countDocuments()
  if (count > 0) return
  await App.insertMany([...defaultApps])
  log.info('Default application catalog written')
}

async function seedAndMigrate() {
  const migrated = await migrateFromLegacyJsonIfEmpty()
  if (!migrated) {
    await seedDefaultAppsIfEmpty()
  }
}

function redactMongoUri(uri) {
  if (!uri || typeof uri !== 'string') return 'unset'
  try {
    const s = uri.trim()
    if (!s.includes('://')) return 'configured'
    const u = new URL(s)
    if (u.password) u.password = '***'
    return u.toString()
  } catch {
    return 'configured'
  }
}

module.exports = {
  connectMongo,
  getState,
  persist,
  persistOne,
  deleteOne,
  genId,
  defaultApps,
  seedAndMigrate,
  redactMongoUri,
  getBdUsers,
  persistBdUser,
  deleteBdUser,
}
