import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..')

export const config = {
  port: Number(process.env.PORT || 3010),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  dbPath: process.env.COMMERCE_DB_PATH || path.join(repoRoot, 'data', 'commerce.db'),
}
