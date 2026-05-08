const express = require('express')
const { getState } = require('../store')

const router = express.Router()

router.get('/', async (_req, res) => {
  const { apps } = await getState()
  res.json({ apps })
})

module.exports = router
