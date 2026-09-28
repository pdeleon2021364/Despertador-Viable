import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../configs/app.js';

test('Express entrega salud, rechaza rutas privadas y no expone cabecera de framework', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(base + '/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(response.headers.get('x-powered-by'), null);
    for (const url of ['/.env', '/package.json', '/no-existe']) {
      assert.equal((await fetch(base + url)).status, 404);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
