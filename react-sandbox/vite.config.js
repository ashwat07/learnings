import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The lab server on :8080 is the data source for every course in this repo. Proxying it
    // keeps everything same-origin, so the sandbox never has to think about CORS.
    proxy: {
      '/api': 'http://localhost:8080',
      '/shared': 'http://localhost:8080',
    },
  },
  build: { sourcemap: true },
});
