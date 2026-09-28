import { loadEnvFile } from 'node:process';
import { createApp } from './configs/app.js';

try { loadEnvFile(new URL('.env', import.meta.url)); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe estar entre 1 y 65535.');
const host = process.env.HOST || '127.0.0.1';
const server = createApp().listen(port, host, () => console.log('Backend: http://' + host + ':' + port));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close();
  server.closeAllConnections();
});
