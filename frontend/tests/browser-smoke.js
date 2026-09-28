import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const origin = process.env.SMOKE_URL || 'http://127.0.0.1:3000';
const profile = await mkdtemp(path.join(tmpdir(), 'despertador-browser-'));
const executable = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--user-data-dir=' + profile, '--use-fake-device-for-media-stream', 'about:blank'],
{ windowsHide: true, stdio: 'ignore' });
let socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await pause(150); }
  throw new Error('Tiempo de espera agotado');
}
try {
  const port = await until(async () => {
    try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
    catch { return null; }
  });
  const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map(), errors = [], networkErrors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result); }
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Network.loadingFailed' && !message.params.canceled) networkErrors.push(message.params.errorText);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function click(selector) {
    const rect = await evaluate('(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 });
  }
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Browser.setPermission', { origin, permission: { name: 'camera' }, setting: 'granted' });
  await send('Page.navigate', { url: origin });
  await until(() => evaluate("document.querySelector('#sound')?.options.length >= 2"));
  assert.equal(errors.length, 0);
  console.log('OK: página compilada y módulos cargados');
  await click('#show-settings');
  assert.equal(await evaluate("document.querySelector('#settings').hidden"), false);
  await evaluate("document.querySelector('#volume').value = '0.75'; document.querySelector('#volume').dispatchEvent(new Event('input', { bubbles: true }))");
  await click('#settings-form button[type=submit]');
  await send('Page.reload');
  await until(() => evaluate("document.querySelector('#sound')?.options.length >= 2"));
  await click('#show-settings');
  assert.equal(await evaluate("document.querySelector('#volume').value"), '0.75');
  await click('#preview-sound');
  await until(() => evaluate("document.querySelector('#preview-sound').textContent.includes('Detener')"));
  await click('#preview-sound');
  await click('#settings-back');
  await click('#show-history');
  assert.ok((await evaluate("document.querySelector('#history-list').textContent")).includes('Todavía'));
  await click('#history-back');
  console.log('OK: ajustes persistidos, sonido, navegación e historial');
  for (const width of [320, 390, 768, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Desbordamiento a ' + width);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const screenshotPath = path.join(tmpdir(), 'despertador-mobile-' + Date.now() + '.png');
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log('Captura: ' + screenshotPath);
  await send('Emulation.clearDeviceMetricsOverride');
  await click('#start');
  await until(() => evaluate("document.querySelector('#calibration-count').textContent.includes('Centra') || !document.querySelector('#error-message').hidden"), 60000);
  assert.equal(await evaluate("document.querySelector('#error-message').hidden"), true,
    await evaluate("document.querySelector('#error-message').textContent") + ' / red: ' + networkErrors.join(', '));
  await click('#cancel');
  await until(() => evaluate("!document.querySelector('#inicio').hidden"));
  assert.equal(await evaluate("Array.from(document.querySelectorAll('video')).every(video => video.srcObject === null)"), true);
  console.log('OK: cámara simulada, MediaPipe real, calibración sin rostro y liberación al cancelar');
  await send('Browser.setPermission', { origin, permission: { name: 'camera' }, setting: 'denied' });
  await click('#start');
  await until(() => evaluate("!document.querySelector('#error-message').hidden"));
  assert.ok((await evaluate("document.querySelector('#error-message').textContent")).includes('Cámara bloqueada'));
  assert.deepEqual(errors, []);
  console.log('OK: permiso denegado y cero errores de JavaScript');
} finally {
  socket?.close();
  browser.kill();
  await pause(1000);
  const resolved = path.resolve(profile);
  if (resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith('despertador-browser-')) {
    await rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => {});
  }
}
