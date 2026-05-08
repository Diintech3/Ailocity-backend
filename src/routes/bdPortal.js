const express = require('express')
const { getState } = require('../store')
const { requireAuth } = require('../middleware/requireAuth')

const router = express.Router()
router.use(requireAuth('bd'))

// role: 'bd' already ensures only ailocity-bd users can access this

async function myBDClient(req) {
  const { clients } = await getState()
  return clients.find((c) => c.id === req.user.sub)
}

router.get('/me', async (req, res) => {
  const c = await myBDClient(req)
  if (!c) return res.status(404).json({ error: 'BD client not found' })
  res.json({
    id: c.id,
    email: c.email,
    fullName: c.fullName,
    businessName: c.businessName,
    mobile: c.mobile,
    status: c.status,
    kyc: c.kyc,
    creditsBalance: c.creditsBalance,
    appId: c.appId,
  })
})

router.get('/dashboard', async (req, res) => {
  const c = await myBDClient(req)
  if (!c) return res.status(404).json({ error: 'BD client not found' })
  res.json({
    stats: {
      totalMeetings: 0,
      trainingsDone: 0,
      agentCalls:    c.totalCalls ?? 0,
      totalEarnings: 0,
    },
  })
})

module.exports = router
