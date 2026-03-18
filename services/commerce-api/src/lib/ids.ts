import crypto from 'node:crypto'

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}
