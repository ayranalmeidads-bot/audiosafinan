/* Service Worker Áudio S.A. — cache versionado, tolerante a assets opcionais ausentes. */
const CACHE_NAME = 'audio-sa-v2';
const APP_ASSETS = [
    './',
    './index.html',
    './style.css',
    './func.js',
    './manifest.json',
    './logo.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // Um arquivo opcional ausente (por exemplo, logo.png) não deve impedir
        // a instalação de todo o Service Worker.
        await Promise.all(APP_ASSETS.map(async (asset) => {
            try {
                const response = await fetch(asset, { cache: 'reload' });
                if (response && response.ok) await cache.put(asset, response);
            } catch (error) {
                console.warn(`Não foi possível pré-carregar ${asset}:`, error);
            }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Nunca intercepta POST, Supabase, CDNs ou qualquer origem externa.
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;

    // Navegação: tenta rede primeiro para reduzir a chance de exibir HTML antigo.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response && response.ok) {
                        const copia = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copia));
                    }
                    return response;
                })
                .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
        );
        return;
    }

    // Arquivos estáticos: entrega cache e atualiza em segundo plano.
    event.respondWith(
        caches.match(request).then((cached) => {
            const atualizacao = fetch(request).then((response) => {
                if (response && response.ok) {
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
                }
                return response;
            }).catch(() => cached);
            return cached || atualizacao;
        })
    );
});