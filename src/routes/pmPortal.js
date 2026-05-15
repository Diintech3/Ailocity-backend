'use strict'

const router = require('express').Router()
const { requireAuth } = require('../middleware/requireAuth')
const { getState } = require('../store')

const auth = requireAuth(['pm', 'app', 'business'])

router.get('/me', auth, async (req, res) => {
  const state = await getState()
  const client = state.clients.find(c => c.id === req.user.sub)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  res.json({
    id: client.id,
    email: client.email,
    fullName: client.fullName,
    businessName: client.businessName,
    mobile: client.mobile,
    appId: client.appId,
    status: client.status,
  })
})

router.use('/projects', require('./pmProjects'))
router.use('/leads',    require('./pmLeads'))
router.use('/folders',  require('./pmFolders'))

module.exports = router
