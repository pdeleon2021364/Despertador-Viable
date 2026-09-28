import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const backend = fileURLToPath(new URL('../', import.meta.url));
const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url));
const vite = fileURLToPath(new URL('../../frontend/node_modules/vite/bin/vite.js', import.meta.url));
if (!existsSync(vite)) throw new Error('Instala primero las dependencias de frontend y backend. Consulta README.md.');
const children = [
  spawn(process.execPath, ['index.js'], { cwd: backend, stdio: 'inherit' }),
  spawn(process.execPath, [vite], { cwd: frontend, stdio: 'inherit' })
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => stop(code || 0));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
