import build from '@hono/vite-build/node'
import devServer from '@hono/vite-dev-server'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    build({
      entry: 'src/index.tsx',
      output: 'dist/index.js',
      minify: false,
      emptyOutDir: true,
      external: [
        '@hono/node-server',
        'bcryptjs',
        'mammoth',
        'pdf-lib'
      ]
    }),
    devServer({
      entry: 'src/index.tsx'
    })
  ]
})
