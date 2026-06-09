const TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", map: "application/json; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", ico: "image/x-icon", avif: "image/avif",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8",
  xml: "application/xml", pdf: "application/pdf", wasm: "application/wasm",
  webmanifest: "application/manifest+json",
};
export function mimeFor(path) {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return TYPES[ext] || "application/octet-stream";
}
