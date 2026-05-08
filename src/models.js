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
})

clientSchema.index({ email: 1, appId: 1 }, { unique: true })
clientSchema.index({ adminId: 1 })

const App = mongoose.models.App || mongoose.model('App', appSchema)
const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema)
const Client = mongoose.models.Client || mongoose.model('Client', clientSchema)

module.exports = { App, Admin, Client }
