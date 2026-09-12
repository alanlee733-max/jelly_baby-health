/* 신생아 데일리 헬스 트래커 — 서비스워커
 *
 * 캐시 전략: 온라인이면 항상 최신을 받고, 캐시는 오프라인용 사본으로만 씁니다.
 *
 * 처음에는 화면 파일을 캐시 우선(stale-while-revalidate)으로 두었는데,
 * 고친 내용이 폰에 한두 번 늦게 도착하는 문제가 반복됐습니다.
 * 이 앱은 전부 합쳐 100KB도 안 되므로, 온라인일 때 매번 받아도 체감 차이가 없습니다.
 * 그래서 "온라인이면 최신, 오프라인이면 사본" 한 가지 규칙으로 통일했습니다.
 *
 *  - 온라인 : 네트워크에서 받아 캐시에 넣고 보여줍니다.
 *            2.5초 안에 응답이 없으면 캐시본을 먼저 보여줍니다(새벽에 기다리지 않도록).
 *  - 오프라인: 네트워크를 아예 시도하지 않고 캐시본을 바로 씁니다.
 *            (실패할 요청 때문에 iOS 가 "비행기모드를 끄세요" 알림을 띄우는 것을 막습니다)
 */

const CACHE_VERSION = 'v3';
const CACHE_NAME = 'nt-cache-' + CACHE_VERSION;
const NET_TIMEOUT = 2500;

// 설치 시 미리 받아둘 앱 셸. 상대 경로라서 GitHub Pages 하위 경로에서도 동작합니다.
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './evaluate.js',
  './chart.js',
  './criteria.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // 파일 하나가 없어도 설치 전체가 실패하지 않도록 개별로 담습니다.
      .then((cache) => Promise.all(
        APP_SHELL.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('nt-cache-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET, 같은 출처만 다룹니다. 그 외에는 브라우저 기본 동작에 맡깁니다.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(req));
});

/* 기기가 오프라인이라고 알려주면 네트워크를 아예 시도하지 않습니다. */
function offline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function fromCache(req) {
  return caches.match(req).then((hit) => hit || offlineFallback(req));
}

function networkFirst(req) {
  if (offline()) return fromCache(req);

  const net = fetch(req).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy));
    }
    return res;
  });

  // 네트워크가 느리면 캐시본을 먼저 보여주되, 받아온 최신본은 캐시에 계속 채워 둡니다.
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res) => { if (!settled) { settled = true; resolve(res); } };

    const timer = setTimeout(() => {
      caches.match(req).then((hit) => { if (hit) finish(hit); });
    }, NET_TIMEOUT);

    net.then(
      (res) => { clearTimeout(timer); finish(res); },
      () => { clearTimeout(timer); fromCache(req).then(finish); }
    );
  });
}

// 오프라인에서 캐시에도 없는 주소를 열면 앱 첫 화면이라도 띄웁니다.
function offlineFallback(req) {
  if (req.mode === 'navigate') {
    return caches.match('./index.html').then(
      (hit) => hit || new Response('오프라인입니다.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })
    );
  }
  return new Response('', { status: 504 });
}
