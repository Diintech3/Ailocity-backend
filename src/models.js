const mongoose = require('mongoose')

const appSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
})

const adminSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  status: { type: String, required: true, default: 'active' },
  createdAt: { type: String, required: true },
  bootstrapFromEnv: { type: Boolean, default: false },
})

// ── Territory Hierarchy ──────────────────────────────────────────────────────
// State → City → Region → POD → Clients

const podSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true },
  regionId:  { type: String, required: true },
  cityId:    { type: String, required: true },
  stateId:   { type: String, required: true },
  podNumber: { type: String, required: true },   // e.g. "POD-001"
  podName:   { type: String, required: true },   // e.g. "Sector 14-28"
  capacity:  { type: Number, default: 100 },
  isActive:  { type: Boolean, default: true },
  createdAt: { type: String, required: true },
})
podSchema.index({ regionId: 1 })
podSchema.index({ stateId: 1, cityId: 1 })

const regionSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true },
  cityId:    { type: String, required: true },
  stateId:   { type: String, required: true },
  name:      { type: String, required: true, enum: ['North', 'South', 'East', 'West', 'Central'] },
  isActive:  { type: Boolean, default: true },
  createdAt: { type: String, required: true },
})
regionSchema.index({ cityId: 1 })

const citySchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true },
  stateId:   { type: String, required: true },
  name:      { type: String, required: true },
  isActive:  { type: Boolean, default: true },
  createdAt: { type: String, required: true },
})
citySchema.index({ stateId: 1 })

const stateSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true },
  name:      { type: String, required: true, unique: true },
  code:      { type: String, default: '' },   // e.g. "DL", "MH"
  isActive:  { type: Boolean, default: true },
  createdAt: { type: String, required: true },
})

// ── Client Schema ────────────────────────────────────────────────────────────

const clientSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  adminId: { type: String, required: true },
  appId: { type: String, required: true },
  fullName: { type: String, required: true },
  email: { type: String, required: true, lowercase: true },
  passwordHash: { type: String, required: true },
  businessName: { type: String, required: true },
  businessLogoKey: { type: String, default: '' },
  websiteUrl: { type: String, default: '' },
  gstNumber: { type: String, default: '' },
  panNumber: { type: String, default: '' },
  mobile: { type: String, required: true },
  address: { type: String, default: '' },
  city: { type: String, default: '' },
  pincode: { type: String, default: '' },
  status: { type: String, required: true },
  kyc: { type: String, required: true },
  source: { type: String, default: 'Direct' },
  owner: { type: String, default: 'Owner' },
  agents: { type: Number, default: 0 },
  creditsBalance: { type: Number, default: 0 },
  totalCalls: { type: Number, default: 0 },
  activeAgentsCount: { type: Number, default: 0 },
  createdAt: { type: String, required: true },
  // Territory assignment
  territory: {
    stateId:    { type: String, default: '' },
    stateName:  { type: String, default: '' },
    cityId:     { type: String, default: '' },
    cityName:   { type: String, default: '' },
    regionId:   { type: String, default: '' },
    regionName: { type: String, default: '' },
    podId:      { type: String, default: '' },
    podNumber:  { type: String, default: '' },
    podName:    { type: String, default: '' },
  },
  portalAgents: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalTickets: { type: [mongoose.Schema.Types.Mixed], default: [] },
  usageStats: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalServices: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalProducts: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalContacts: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalDataStore: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalLeads: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalCampaigns: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalContent: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalReels: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalMeetings: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalDialReports: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalDialCalls: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalTcTrainings: { type: [mongoose.Schema.Types.Mixed], default: [] },
  portalAICalls: { type: [mongoose.Schema.Types.Mixed], default: [] },
})

clientSchema.index({ email: 1, appId: 1 }, { unique: true })
clientSchema.index({ adminId: 1 })
clientSchema.index({ 'territory.podId': 1 })
clientSchema.index({ 'territory.stateId': 1, 'territory.cityId': 1 })

const bdUserSchema = new mongoose.Schema({
  id:          { type: String, required: true, unique: true },
  bdClientId:  { type: String, required: true },   // BD partner ka client ID
  fullName:    { type: String, required: true },
  email:       { type: String, required: true, lowercase: true },
  mobile:      { type: String, required: true },
  city:        { type: String, default: '' },
  pincode:     { type: String, default: '' },
  address:     { type: String, default: '' },
  imageKey:    { type: String, default: '' },
  accountType: { type: String, default: 'New' },
  dob:         { type: String, default: '' },
  profession:  { type: String, default: '' },
  role:        { type: String, default: 'bd user' },
  passwordHash:{ type: String, required: true },
  createdAt:   { type: String, required: true },
})

bdUserSchema.index({ email: 1, bdClientId: 1 }, { unique: true })
bdUserSchema.index({ bdClientId: 1 })

const App    = mongoose.models.App    || mongoose.model('App',    appSchema)
const Admin  = mongoose.models.Admin  || mongoose.model('Admin',  adminSchema)
const Client = mongoose.models.Client || mongoose.model('Client', clientSchema)
const BdUser = mongoose.models.BdUser || mongoose.model('BdUser', bdUserSchema)
const State  = mongoose.models.State  || mongoose.model('State',  stateSchema)
const City   = mongoose.models.City   || mongoose.model('City',   citySchema)
const Region = mongoose.models.Region || mongoose.model('Region', regionSchema)
const Pod    = mongoose.models.Pod    || mongoose.model('Pod',    podSchema)

module.exports = { App, Admin, Client, BdUser, State, City, Region, Pod }
