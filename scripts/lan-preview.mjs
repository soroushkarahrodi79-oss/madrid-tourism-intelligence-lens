#!/usr/bin/env node
// Read-only static preview of THIS checkout for a device on the same local
// network (e.g. an iPad). Safety properties:
//   * binds to ONE private/loopback IPv4 address only; refuses 0.0.0.0, public
//     addresses and IPv6 wildcards, so it is never exposed beyond the LAN
//   * GET/HEAD only, files under the repository root only, no directory listing
//   * no write path, no proxying, no telemetry; stops on Ctrl-C
// Usage: node scripts/lan-preview.mjs [--host 192.168.x.y] [--port 8080]
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".geojson": "application/geo+json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };

export function isPrivateIPv4(host) {
  const m = String(host).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  if (o[0] === 0 || (o[0] === 255)) return false;
  return o[0] === 127 || o[0] === 10 || (o[0] === 192 && o[1] === 168) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function detectLanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === "IPv4" && !a.internal && isPrivateIPv4(a.address)) return a.address;
  }
  return null;
}

export function createPreviewServer() {
  return http.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") return response.writeHead(405, { allow: "GET, HEAD" }).end();
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, "http://x").pathname); } catch { return response.writeHead(400).end(); }
    const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
    if (target !== path.join(ROOT, "index.html") && !target.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end("Forbidden");
    if (target.split(path.sep).includes(".git") || target.split(path.sep).includes("node_modules")) return response.writeHead(403).end("Forbidden");
    fs.stat(target, (statError, stat) => {
      if (statError || !stat.isFile()) return response.writeHead(404).end("Not found");
      response.writeHead(200, { "content-type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      if (request.method === "HEAD") return response.end();
      fs.createReadStream(target).pipe(response);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = arg("host", detectLanAddress());
  const port = Number(arg("port", "8080"));
  if (!host) { console.error("No private LAN IPv4 address found. Pass --host <your 192.168.x.x / 10.x.x.x / 172.16-31.x.x address>."); process.exit(2); }
  if (!isPrivateIPv4(host)) { console.error(`Refusing to bind ${host}: only private or loopback IPv4 addresses are allowed (never 0.0.0.0 or a public address).`); process.exit(2); }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error("Port must be 1024-65535."); process.exit(2); }
  createPreviewServer().listen(port, host, () => {
    console.log(`UX-C1 preview of this checkout (read-only, LAN only): http://${host}:${port}/`);
    console.log("Open that URL in iPad Safari on the SAME Wi-Fi. Press Ctrl-C to stop.");
  });
}
