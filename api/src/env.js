import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

dotenv.config({ path: resolve(__dirname, '../.env') })
dotenv.config({ path: resolve(__dirname, '../../.env') })
