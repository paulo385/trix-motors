/* Service worker: deixa o app abrir rápido e funcionar sem internet.
   Busca sempre a versão nova quando há internet; sem internet, usa a cópia guardada.
   Ao publicar mudanças, aumente VERSAO aqui e o ?v= no index.html. */
const VERSAO = "trix-v21";
const ARQUIVOS = [
  "./",
  "./index.html",
  "./style.css?v=21",
  "./config.js?v=21",
  "./lib/supabase.js?v=21",
  "./script.js?v=21",
  "./pdf.js?v=21",
  "./manifest.json?v=21",
  "./lib/jspdf.umd.min.js?v=21",
  "./lib/jspdf.plugin.autotable.min.js?v=21",
  "./privacidade.html",
  "./fonts/barlow-semi-condensed-latin-500-normal.woff2",
  "./fonts/barlow-semi-condensed-latin-600-normal.woff2",
  "./fonts/barlow-semi-condensed-latin-700-normal.woff2",
  "./fonts/source-sans-3-latin-400-normal.woff2",
  "./fonts/source-sans-3-latin-500-normal.woff2",
  "./fonts/source-sans-3-latin-600-normal.woff2",
  "./fonts/source-sans-3-latin-700-normal.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.ico",
  "./icons/favicon-32.png",
  "./icons/favicon-64.png",
  "./icons/logo-trix.png",
  "./icons/logo-mark.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => !k.startsWith(VERSAO)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  // Arquivos do app: rede primeiro (sempre a versão mais nova), cópia guardada quando estiver sem internet
  e.respondWith(
    fetch(req).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then(c => c.put(req.mode === "navigate" ? "./index.html" : req, copia)); }
      return r;
    }).catch(() => caches.match(req.mode === "navigate" ? "./index.html" : req, { ignoreSearch: req.mode === "navigate" }))
  );
});

// Toque no aviso "novo pedido de acesso": abre o app na aba Usuários
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || "./#usuarios", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(lista => {
    for (const c of lista) { if ("focus" in c) { c.navigate(alvo).catch(() => {}); return c.focus(); } }
    return clients.openWindow(alvo);
  }));
});
