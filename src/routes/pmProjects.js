'use strict'

const router = require('express').Router()
const { requireAuth } = require('../middleware/requireAuth')
const { PmProject } = require('../models')
const { genId } = require('../store')

const auth = requireAuth(['pm', 'app', 'business'])

router.get('/', auth, async (req, res) => {
  const projects = await PmProject.find().sort({ createdAt: -1 }).lean()
  res.json({ projects })
})

router.post('/', auth, async (req, res) => {
  const { name, client, budget, startDate, endDate, status, notes } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
  const project = {
    id: genId('prj'),
    name: name.trim(),
    client: client || '',
    budget: budget || '',
    startDate: startDate || '',
    endDate: endDate || '',
    status: status || 'active',
    notes: notes || '',
    createdAt: new Date().toISOString(),
  }
  await PmProject.create(project)
  res.status(201).json({ project })
})

router.put('/:id', auth, async (req, res) => {
  const { name, client, budget, startDate, endDate, status, notes } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' })
  const project = await PmProject.findOneAndUpdate(
    { id: req.params.id },
    { name: name.trim(), client: client || '', budget: budget || '', startDate: startDate || '', endDate: endDate || '', status: status || 'active', notes: notes || '' },
    { new: true }
  ).lean()
  if (!project) return res.status(404).json({ error: 'Project not found' })
  res.json({ project })
})

router.delete('/:id', auth, async (req, res) => {
  await PmProject.deleteOne({ id: req.params.id })
  res.json({ ok: true })
})

module.exports = router
