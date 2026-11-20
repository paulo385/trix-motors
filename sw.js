/* Service worker: deixa o app abrir rápido e funcionar sem internet.
   Busca sempre a versão nova quando há internet; sem internet, usa a cópia guardada.
   Ao publicar mudanças, aumente VERSAO aqui e o ?v= no index.html. */
const VERSAO = "trix-v6";
const ARQUIVOS = [
  "./",
  "./index.html",
  "./style.css?v=6",
  "./config.js?v=6",
  "./lib/supabase.js?v=6",
  "./script.js?v=6",
  "./pdf.js?v=6",
  "./manifest.json?v=6",
  "./lib/jspdf.umd.min.js?v=6",
  "./lib/jspdf.plugin.autotable.min.js?v=6",
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

  // Fontes do Google: guarda depois do primeiro uso
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(VERSAO + "-fontes").then(async c => {
      const salvo = await c.match(req);
      if (salvo) return salvo;
      try { const r = await fetch(req); if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }
      catch (err) { return Response.error(); }
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Arquivos do app: rede primeiro (sempre a versão mais nova), cópia guardada quando estiver sem internet
  e.respondWith(
    fetch(req).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then(c => c.put(req.mode === "navigate" ? "./index.html" : req, copia)); }
      return r;
    }).catch(() => caches.match(req.mode === "navigate" ? "./index.html" : req, { ignoreSearch: req.mode === "navigate" }))
  );
});
