'use strict'

const router = require('express').Router()
const { requireAuth } = require('../middleware/requireAuth')
const { PmLead } = require('../models')
const { genId } = require('../store')

const auth = requireAuth(['pm', 'app', 'business'])

function buildPayload(body) {
  return {
    name:            (body.name || '').trim(),
    company:         body.company         || '',
    logoKey:         body.logoKey         || '',
    businessType:    body.businessType    || '',
    category:        body.category        || '',
    subCategory:     body.subCategory     || '',
    websiteUrl:      body.websiteUrl      || '',
    email:           body.email           || '',
    mobile:          body.mobile          || '',
    alternateMobile: body.alternateMobile || '',
    gstNumber:       body.gstNumber       || '',
    panNumber:       body.panNumber       || '',
    address:         body.address         || '',
    city:            body.city            || '',
    state:           body.state           || '',
    pincode:         body.pincode         || '',
    country:         body.country         || 'India',
    instagramUrl:    body.instagramUrl    || '',
    facebookUrl:     body.facebookUrl     || '',
    youtubeUrl:      body.youtubeUrl      || '',
    type:            body.type            || 'hot',
    mbcSubCategory:  body.mbcSubCategory  || '',
    source:          body.source          || 'Direct',
    requirement:     body.requirement     || '',
    budget:          body.budget          || '',
    status:          body.status          || 'new',
    priority:        body.priority        || 'medium',
    kyc:             body.kyc             || 'pending',
    notes:           body.notes           || '',
    folderId:        body.folderId         || '',
  }
}

router.get('/', auth, async (req, res) => {
  const leads = await PmLead.find({ pmClientId: req.user.sub }).sort({ createdAt: -1 }).lean()
  res.json({ leads })
})

router.post('/', auth, async (req, res) => {
  if (!req.body.name?.trim()) return res.status(400).json({ error: 'Name is required' })
  const now = new Date().toISOString()
  const lead = { id: genId('ld'), pmClientId: req.user.sub, ...buildPayload(req.body), folderId: req.body.folderId || '', createdAt: now, updatedAt: now }
  await PmLead.create(lead)
  res.status(201).json({ lead })
})

router.put('/:id', auth, async (req, res) => {
  if (!req.body.name?.trim()) return res.status(400).json({ error: 'Name is required' })
  const lead = await PmLead.findOneAndUpdate(
    { id: req.params.id, pmClientId: req.user.sub },
    { ...buildPayload(req.body), updatedAt: new Date().toISOString() },
    { new: true }
  ).lean()
  if (!lead) return res.status(404).json({ error: 'Lead not found' })
  res.json({ lead })
})

router.delete('/:id', auth, async (req, res) => {
  await PmLead.deleteOne({ id: req.params.id, pmClientId: req.user.sub })
  res.json({ ok: true })
})

module.exports = router
