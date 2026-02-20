import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward serverless function requests during local Vite dev.
      // Set VITE_API_PROXY_TARGET if your API server runs elsewhere.
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      // Proxy 3D model requests to cdn.modelviewer.lol to avoid CORS issues
      '/model-cdn': {
        target: 'https://cdn.modelviewer.lol',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/model-cdn/, ''),
      },
      // Proxy Summoner's Rift terrain tiles from summonersrift.mvilim.dev
      '/map-tiles': {
        target: 'https://summonersrift.mvilim.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/map-tiles/, ''),
      },
      // Proxy CommunityDragon for chroma data
      '/cdragon': {
        target: 'https://raw.communitydragon.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cdragon/, ''),
      },
    },
  },
})
