import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ command }) => ({
  plugins: [react(), {
    name: 'desktop-production-csp',
    transformIndexHtml: command === 'build' ? () => [{
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'none'; object-src 'none'; frame-src about:; base-uri 'none'; form-action 'none'" },
      injectTo: 'head',
    }] : undefined,
  }],
  base: './',
  optimizeDeps: { entries: ['index.html', 'dialog.html'] },
  build: { rollupOptions: { input: { main: 'index.html', dialog: 'dialog.html' } } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, watch: { ignored: ['work', 'outputs', 'output'].map(directory => path.resolve(directory).replaceAll('\\', '/') + '/**') } },
}));
