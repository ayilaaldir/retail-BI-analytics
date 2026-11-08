import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const dist = resolve('dist')
const forbidden = ['/__local/dashboard.json', 'data/local/dashboard.json']

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesIn(path) : [path]
  }))
  return nested.flat()
}

const files = await filesIn(dist)
for (const file of files) {
  const normalized = file.replaceAll('\\', '/')
  if (normalized.includes('/dist/__local/')) {
    throw new Error(`Development-only data was emitted: ${normalized}`)
  }
  if (/\.(?:html|js|css|json|map)$/i.test(file)) {
    const contents = await readFile(file, 'utf8')
    const leaked = forbidden.find((value) => contents.includes(value))
    if (leaked) throw new Error(`Development-only reference ${leaked} found in ${normalized}`)
  }
}

console.log('Production boundary verified: no local dashboard data or development endpoint in dist.')
