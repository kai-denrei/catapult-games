/* =============================================================
   CATAPULT — service worker (vanilla, no Workbox)
   ============================================================= */
/* Token rewritten by scripts/bust.sh on every cache bump. */
const CB_TOKEN = 'f77673b4';
const CACHE_NAME = `catapult-${CB_TOKEN}`;
const OFFLINE_URL = './offline.html';

/* Precache list — paths are relative to the SW scope so they work under
   both root deployment and the GitHub Pages sub-path /catapult-games/. */
const PRECACHE = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './styles/base.css',
  './styles/iterations.css',
  './lineage.svg',
  './lib/canvas.js',
  './lib/ballistics.js',
  './lib/input.js',
  './lib/rng.js',
  './iterations/01-artillery.js',
  './iterations/02-smithereens.js',
  './iterations/03-defender.js',
  './iterations/04-scorched.js',
  './iterations/05-crush.js',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-maskable.svg',
  './icons/apple-touch-icon.svg',
];

/* -------- install -------------------------------------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    /* Use individual fetches with {cache:'reload'} so the SW install never
       picks up a stale HTTP-cached copy. addAll() would batch-fail on the
       first 404; tolerate missing optional assets instead. */
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const req = new Request(url, { cache: 'reload' });
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          await cache.put(url, res);
        }
      } catch (_) {
        /* Tolerate a missing precache entry; the main thread will recover. */
      }
    }));
    /* NOTE: do NOT call skipWaiting() here. The main thread will postMessage
       {type:'SKIP_WAITING'} when the user accepts the update toast. */
  })());
});

/* -------- activate ------------------------------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('catapult-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* -------- message: SKIP_WAITING ------------------------------------ */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* -------- fetch router --------------------------------------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Same-origin only — never cache cross-origin requests. */
  if (url.origin !== self.location.origin) return;

  /* HTML navigation: network-first with 3s timeout, fall back to cache,
     then to the editorial offline page. */
  const accept = req.headers.get('accept') || '';
  if (req.mode === 'navigate' || accept.includes('text/html')) {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  /* Fingerprinted assets (?v=<token>): immutable by contract, cache-first. */
  if (url.search.includes('v=')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  /* Everything else (icons, manifest, unfingerprinted): stale-while-revalidate. */
  event.respondWith(staleWhileRevalidate(req));
});

/* -------- strategies ----------------------------------------------- */
async function networkFirstNavigation(event) {
  const req = event.request;
  const cache = await caches.open(CACHE_NAME);

  /* Use the navigation preload response if available — it was kicked off
     in parallel with SW startup, so we get a head start. */
  const preloadPromise = event.preloadResponse
    ? Promise.resolve(event.preloadResponse).catch(() => null)
    : Promise.resolve(null);

  try {
    const networkPromise = (async () => {
      const preload = await preloadPromise;
      if (preload) return preload;
      return fetch(req);
    })();

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('navigation-timeout')), 3000);
    });

    const res = await Promise.race([networkPromise, timeoutPromise]);
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (_) {
    const cached = await cache.match(req);
    if (cached) return cached;
    const indexCached = await cache.match('./index.html');
    if (indexCached) return indexCached;
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('offline', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    /* Last resort — try the same URL without the query string in case a
       precached copy exists under the un-fingerprinted name. */
    const bare = new URL(req.url);
    bare.search = '';
    const bareCached = await cache.match(bare.toString());
    if (bareCached) return bareCached;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || network;
}
