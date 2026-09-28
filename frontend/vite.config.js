import { defineConfig } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';

const wasmDir = new URL('./node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
const fileSounds = readdirSync(new URL('./public/sounds/', import.meta.url))
  .filter(file => /\.(mp3|ogg|wav)$/i.test(file))
  .map(file => ({ id: 'file-' + file, name: file.replace(/\.[^.]+$/, ''), type: 'file',
    filePath: '/sounds/' + encodeURIComponent(file), durationSec: 30, intensity: 'fuerte', isDefault: false }));
export default defineConfig({
  define: { 'import.meta.env.VITE_LOCAL_SOUNDS': JSON.stringify(fileSounds) },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/health': 'http://127.0.0.1:3000' } },
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [{
    name: 'vision-runtime',
    configureServer(server) {
      const files = readdirSync(wasmDir);
      server.middlewares.use('/vision', (req, res, next) => {
        const file = (req.url || '').split('?')[0].slice(1);
        if (!files.includes(file) || !/\.(wasm|js)$/.test(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(new URL(file, wasmDir)));
      });
    },
    generateBundle() {
      for (const file of readdirSync(wasmDir)) {
        if (/\.(wasm|js)$/.test(file)) this.emitFile({ type: 'asset', fileName: 'vision/' + file, source: readFileSync(new URL(file, wasmDir)) });
      }
    }
  }]
});
