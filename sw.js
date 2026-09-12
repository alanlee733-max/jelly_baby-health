/* 신생아 데일리 헬스 트래커 — 서비스워커
 *
 * 캐시 전략은 파일 성격에 따라 둘로 나눕니다.
 *
 *  1) criteria.json  → 네트워크 우선(network-first)
 *     판정 기준은 앞으로 계속 고칠 파일입니다. 온라인이면 항상 최신본을 받아오고,
 *     오프라인일 때만 마지막으로 받아둔 사본을 씁니다. (기준을 고쳐 배포하면
 *     다음 실행에서 바로 반영됩니다.)
 *
 *  2) 나머지 앱 파일 → 캐시 우선 + 뒤에서 갱신(stale-while-revalidate)
 *     새벽에 오프라인이어도 즉시 뜨는 것이 중요하므로 캐시를 먼저 보여주고,
 *     백그라운드에서 새 버전을 받아둡니다. 새 버전은 다음에 앱을 열 때 보입니다.
 *
 * 앱 파일(html/js/css)을 고쳐 배포할 때는 아래 CACHE_VERSION 숫자를 함께 올리세요.
 * 그래야 브라우저가 서비스워커가 바뀐 것을 알아차리고, 새 파일을 받아
 * 앱이 다음에 열릴 때 스스로 새로고침합니다 (app.js 의 registerSW 참고).
 */

const CACHE_VERSION = 'v2';
const CACHE_NAME = 'nt-cache-' + CACHE_VERSION;

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

/* 기기가 오프라인이라고 알려주면 네트워크를 아예 시도하지 않습니다.
 * 비행기모드에서 요청을 걸면 iOS 가 "비행기모드를 끄세요" 시스템 알림을 띄우는데,
 * 어차피 실패할 요청 때문에 새벽마다 알림이 뜨는 것을 막기 위해서입니다. */
function offline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET, 같은 출처만 다룹니다. 그 외에는 브라우저 기본 동작에 맡깁니다.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/criteria.json')) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(staleWhileRevalidate(req));
  }
});

function networkFirst(req) {
  if (offline()) {
    return caches.match(req).then((hit) => hit || offlineFallback(req));
  }
  return fetch(req)
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
      }
      return res;
    })
    .catch(() => caches.match(req).then((hit) => hit || offlineFallback(req)));
}

function staleWhileRevalidate(req) {
  return caches.match(req).then((cached) => {
    // 오프라인이고 캐시에 있으면 그대로 돌려줍니다. 뒤에서 갱신하려 애쓰지 않습니다.
    if (cached && offline()) return cached;

    const fresh = fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => null);

    return cached || fresh.then((res) => res || offlineFallback(req));
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
