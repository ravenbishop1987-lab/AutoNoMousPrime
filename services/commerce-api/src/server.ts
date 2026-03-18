import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { attributionRouter } from './routes/attribution.js'
import { catalogRouter } from './routes/catalog.js'
import { ctasRouter } from './routes/ctas.js'
import { publicRouter } from './routes/public.js'
import { revenueRouter } from './routes/revenue.js'
import { stripeRouter } from './routes/stripe.js'
import './lib/db.js'

const app = express()

app.use(cors())
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'commerce-api', port: config.port })
})

app.use('/api/ctas', ctasRouter)
app.use('/api/catalog', catalogRouter)
app.use('/api/track', attributionRouter)
app.use('/api/stripe', stripeRouter)
app.use('/api/revenue', revenueRouter)
app.use(publicRouter)

app.listen(config.port, () => {
  console.log(`Commerce API listening on http://localhost:${config.port}`)
})
