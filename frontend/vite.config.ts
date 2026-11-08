import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

function localDashboardData(): Plugin {
  const localDataPath = fileURLToPath(new URL('../data/local/dashboard.json', import.meta.url))
  return {
    name: 'local-dashboard-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__local/dashboard.json', async (_request, response) => {
        try {
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(await readFile(localDataPath, 'utf8'))
        } catch {
          response.statusCode = 404
          response.end(JSON.stringify({ status: 'unavailable', reason: 'Run the local export pipeline first.' }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), localDashboardData()],
})
