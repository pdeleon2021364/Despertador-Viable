# Despertador Anti-Sueño

Aplicación pública sin login. Express sirve el frontend compilado y `GET /health`.
La cámara, MediaPipe, la calibración y el audio funcionan en el navegador. No se graba ni se transmite el video.

## Estructura

```text
backend/
  configs/app.js          Configuración de Express y archivos estáticos
  middlewares/http.js     Cabeceras y respuesta 404
  scripts/dev.js          Arranque de ambos servidores en desarrollo
  src/health.js           Endpoint /health
  tests/server.test.js
  node_modules/          Generado por pnpm
  .env, .gitignore, index.js, package.json, pnpm-lock.yaml
frontend/
  src/                   app, entities, storage, detector, calibration, alarm, styles
  tests/                 Pruebas unitarias y comprobación del navegador
  public/sounds/         MP3, OGG o WAV opcionales
  dist/                  Generado por Vite
  node_modules/          Generado por npm
  .env, .gitignore, eslint.config.js, index.html, package.json
  package-lock.json, pnpm-lock.yaml, vite.config.js
package.json             Comandos para ejecutar ambas carpetas desde la raíz
```

## Requisitos e instalación

Node.js 22.12 o superior y pnpm. Desde la raíz:

```sh
pnpm --dir backend install --frozen-lockfile
npm --prefix frontend ci
npm run dev
```

Abre **http://127.0.0.1:5173**. El backend escucha en el puerto 3000.
En PowerShell, si la política bloquea `npm.ps1` o `pnpm.ps1`, usa `npm.cmd` y `pnpm.cmd`.

También puedes ejecutarlos por separado: `pnpm --dir backend dev` y `npm --prefix frontend run dev`.
El frontend se instaló con npm; se incluye también el lockfile de pnpm solicitado. Usa un solo gestor por instalación del frontend y actualiza ambos lockfiles si cambias sus dependencias.

## Compilar y ejecutar

```sh
npm run build
npm start
```

Abre **http://127.0.0.1:3000**. `GET /health` devuelve `{"status":"ok"}`.
Detén el entorno de desarrollo antes de usar `npm start`, pues ambos usan el puerto 3000.

`backend/.env` admite `PORT` y `HOST` (valores predeterminados: 3000 y 127.0.0.1).
`frontend/.env` admite `VITE_MODEL_URL`, con el modelo Face Landmarker oficial de Google como valor predeterminado.
No guardes secretos en variables `VITE_*`: se incluyen en el navegador.
Los archivos `.env` locales están ignorados por Git; la app también funciona con sus valores predeterminados si no existen.

Fuera de localhost/127.0.0.1, sirve la app mediante HTTPS con un certificado válido; la cámara y Wake Lock lo necesitan.
Para un sitio público, un proxy HTTPS puede dirigir el tráfico a Express. No se incluyen configuraciones de plataformas ni contenedores.
Para probar desde otro dispositivo de tu red también necesitarás HTTPS, además de configurar la dirección de escucha.

## Uso

1. Ajusta sensibilidad, tiempo de ojos cerrados, inclinación, sonido, volumen y opciones.
2. Pulsa **Iniciar vigilancia** para habilitar el audio y conceder acceso a la cámara.
3. Mira al frente, despierto y con buena luz, durante unos cinco segundos estables.
4. Mantén la pestaña visible. **Estoy despierto** detiene la alarma; también se detiene después de tres segundos continuos con ojos abiertos y cabeza erguida.
5. Puedes pausar, reanudar o terminar. El historial muestra sesiones, señales detectadas y cómo se respondió.

Al ocultar la pestaña se pausa la detección y se deshabilita la pista de cámara. Una alarma que ya sonaba continúa hasta responder.
Al volver, pulsa **Reanudar vigilancia**. Finalizar o cancelar libera la cámara, el modelo, el audio y el Wake Lock.
Si la cámara está bloqueada, permite su uso desde el icono de permisos del navegador y vuelve a intentar.

## Detección y datos

El EAR se calcula con distancias corregidas por la proporción del video; la inclinación es una estimación geométrica relativa entre frente y mentón.
Se suavizan cinco frames. Los ojos deben permanecer cerrados el tiempo configurado; el cabeceo se mantiene 700 ms y el bostezo opcional 1200 ms.
Hay un cooldown de ocho segundos. Los frames ausentes o interrumpidos reinician los tiempos de detección y de recuperación.
La calibración usa medianas y rechaza muestras insuficientes o movimientos excesivos.

MediaPipe se carga bajo demanda y el runtime WASM se sirve localmente desde la misma versión instalada del paquete.
El modelo se descarga de Google al iniciar: necesitas conexión para esa descarga. Si GPU falla, se intenta CPU.
La inferencia está limitada aproximadamente a 15 frames por segundo en el hilo del navegador.

Las entidades Device, Settings, Calibration, AlarmSound, MonitoringSession, DrowsinessEvent y ScheduledAlarm incluyen validación en `entities.js`.
`storage.js` aísla localStorage, conserva hasta 100 sesiones y 1000 eventos, y funciona en memoria si el almacenamiento no está disponible o se llena.
ScheduledAlarm está modelada y permanece desactivada; este MVP no programa alarmas por hora.

Los dos sonidos incluidos son sintetizados con Web Audio. Para añadir audio propio con licencia de uso, coloca un archivo en `frontend/public/sounds/` y vuelve a compilar o reinicia Vite.
Los archivos se incorporan al selector. No se incluye música comercial.

## Comprobaciones

```sh
npm test
npm run lint
npm run build
```

Las pruebas cubren EAR, pitch, parpadeos, duración, sensibilidad, cooldown, rostro perdido, recuperación, calibración, almacenamiento, audio y servidor.
Con el servidor iniciado y Google Chrome instalado en Windows:

```sh
node frontend/tests/browser-smoke.js
```

La comprobación de navegador utiliza un perfil temporal y cámara simulada. Puedes configurar `CHROME_PATH` y `SMOKE_URL` para otra instalación o para probar el servidor de desarrollo.

La detección real depende de iluminación, cámara, postura y dispositivo; los tests simulados no certifican su precisión con personas.
**Esta app no es un dispositivo de seguridad. No la uses como única protección al conducir u operar maquinaria.**

Referencia de la integración: [MediaPipe Face Landmarker para JavaScript](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).
