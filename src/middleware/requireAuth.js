'use strict'

const { verify } = require('../auth')
const log        = require('../logger')

function requireAuth(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles]

  return (req, res, next) => {
    const h     = req.headers.authorization
    const token = h && h.startsWith('Bearer ') ? h.slice(7) : null

    if (!token) {
      log.warn('Auth rejected — missing token', { reqId: req.id, path: req.path })
      return res.status(401).json({ error: 'Missing token' })
    }

    try {
      const payload = verify(token)

      if (!allowed.includes(payload.role)) {
        log.warn('Auth rejected — insufficient role', {
          reqId:    req.id,
          role:     payload.role,
          required: allowed.join('|'),
          path:     req.path,
        })
        return res.status(403).json({ error: 'Forbidden' })
      }

      req.user = payload
      return next()
    } catch (err) {
      log.warn('Auth rejected — invalid token', { reqId: req.id, reason: err.message, path: req.path })
      return res.status(401).json({ error: 'Invalid token' })
    }
  }
}

module.exports = { requireAuth }
