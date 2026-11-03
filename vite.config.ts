import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react(), {
    name: 'desktop-production-csp',
    transformIndexHtml: command === 'build' ? () => [{
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" },
      injectTo: 'head',
    }] : undefined,
  }],
  base: './',
  build: { rollupOptions: { input: { main: 'index.html', dialog: 'dialog.html' } } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
