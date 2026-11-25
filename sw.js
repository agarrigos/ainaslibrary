// =====================================================
//  Aina's Library — service worker
//  · La app (HTML, CSS, JS, iconos) se sirve al instante desde el móvil y se
//    actualiza en segundo plano. Si hay versión nueva, la app avisa para recargar.
//  · Fuentes, librerías y portadas se guardan una vez y no se vuelven a descargar.
//  · Los datos de Supabase NUNCA se guardan aquí: siempre van a internet.
// =====================================================

const SHELL = 'shell-v1';
const RUNTIME = 'runtime-v1';
const COVERS = 'covers-v1';
const MAX_COVERS = 400;

const SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'config.js',
  'manifest.json',
  'icon-180.jpg',
  'icon-192.jpg',
  'icon-512.jpg',
  'jack-240.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = [SHELL, RUNTIME, COVERS];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Datos y sesión de Supabase: siempre por internet
  if (url.hostname.endsWith('.supabase.co')) return;

  if (url.origin === self.location.origin) {
    event.respondWith(appShell(event));
    return;
  }
  if (url.hostname === 'covers.openlibrary.org' || url.hostname.endsWith('.archive.org')) {
    event.respondWith(cover(req));
    return;
  }
  if (['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'].includes(url.hostname)) {
    event.respondWith(cacheFirst(req, RUNTIME));
  }
});

// ---------- La app: al instante desde el móvil y se revisa en segundo plano ----------
let refreshing = null;

async function appShell(event) {
  const req = event.request;
  const cache = await caches.open(SHELL);
  // Todas las páginas de la app son index.html
  const key = req.mode === 'navigate' ? 'index.html' : req;
  const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });

  const update = fetch(req.mode === 'navigate' ? 'index.html' : req, { cache: 'no-cache' })
    .then(async (res) => {
      if (!res || !res.ok) return res;
      const changed = cached && changedFile(cached, res);
      await cache.put(key, res.clone());
      // Si ha cambiado algún archivo de la app, se descargan todos juntos (para que
      // no se mezclen versiones) y se avisa a la app para que ofrezca recargar
      if (changed) event.waitUntil(refreshShell());
      return res;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  return (await update) || new Response('Sin conexión', { status: 503, statusText: 'Offline' });
}

function changedFile(oldRes, newRes) {
  const a = oldRes.headers.get('etag') || oldRes.headers.get('last-modified');
  const b = newRes.headers.get('etag') || newRes.headers.get('last-modified');
  return Boolean(a && b && a !== b);
}

function refreshShell() {
  if (!refreshing) {
    refreshing = caches.open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => c.postMessage({ type: 'app-updated' })))
      .catch(() => {})
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

// ---------- Fuentes y librerías: no cambian ----------
async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

// ---------- Portadas: se guardan (hasta MAX_COVERS, las más antiguas se borran) ----------
async function cover(req) {
  const cache = await caches.open(COVERS);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(req, res.clone());
      trimCovers(cache);
    }
    return res;
  } catch (err) {
    return new Response('', { status: 504 });
  }
}

let trimming = false;
async function trimCovers(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    const extra = keys.length - MAX_COVERS;
    for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
  } finally {
    trimming = false;
  }
}
