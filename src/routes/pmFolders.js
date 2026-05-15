'use strict'

const router = require('express').Router()
const { requireAuth } = require('../middleware/requireAuth')
const { PmFolder, PmLead } = require('../models')
const { genId } = require('../store')

const auth = requireAuth(['pm', 'app', 'business'])

// GET all folders
router.get('/', auth, async (req, res) => {
  const folders = await PmFolder.find({ pmClientId: req.user.sub }).sort({ createdAt: 1 }).lean()
  res.json({ folders })
})

// POST create folder
router.post('/', auth, async (req, res) => {
  const { name, category, subCategory, color } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
  const folder = {
    id: genId('fld'),
    pmClientId: req.user.sub,
    name: name.trim(),
    category: category || '',
    subCategory: subCategory || '',
    color: color || '#FF7A00',
    createdAt: new Date().toISOString(),
  }
  await PmFolder.create(folder)
  res.status(201).json({ folder })
})

// PUT update folder
router.put('/:id', auth, async (req, res) => {
  const { name, category, subCategory, color } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
  const folder = await PmFolder.findOneAndUpdate(
    { id: req.params.id, pmClientId: req.user.sub },
    { name: name.trim(), category: category || '', subCategory: subCategory || '', color: color || '#FF7A00' },
    { new: true }
  ).lean()
  if (!folder) return res.status(404).json({ error: 'Folder not found' })
  res.json({ folder })
})

// DELETE folder (leads ko unassign karo, delete mat karo)
router.delete('/:id', auth, async (req, res) => {
  await PmFolder.deleteOne({ id: req.params.id, pmClientId: req.user.sub })
  await PmLead.updateMany({ pmClientId: req.user.sub, folderId: req.params.id }, { $set: { folderId: '' } })
  res.json({ ok: true })
})

// PATCH — lead ko folder me assign/unassign karo
router.patch('/:id/assign', auth, async (req, res) => {
  const { leadIds } = req.body  // array of lead ids
  if (!Array.isArray(leadIds)) return res.status(400).json({ error: 'leadIds array required' })
  await PmLead.updateMany(
    { pmClientId: req.user.sub, id: { $in: leadIds } },
    { $set: { folderId: req.params.id } }
  )
  res.json({ ok: true })
})

// PATCH — lead ko folder se remove karo
router.patch('/:id/unassign', auth, async (req, res) => {
  const { leadIds } = req.body
  if (!Array.isArray(leadIds)) return res.status(400).json({ error: 'leadIds array required' })
  await PmLead.updateMany(
    { pmClientId: req.user.sub, id: { $in: leadIds }, folderId: req.params.id },
    { $set: { folderId: '' } }
  )
  res.json({ ok: true })
})

module.exports = router
