import express from 'express';
import { fileURLToPath } from 'node:url';
import { securityHeaders, notFound } from '../middlewares/http.js';
import { health } from '../src/health.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.get('/health', health);
  app.use(express.static(fileURLToPath(new URL('../../frontend/dist/', import.meta.url))));
  app.get('/', (_req, res) => res.status(503).type('text').send('Primero ejecuta npm run build en frontend.'));
  app.use(notFound);
  return app;
}
