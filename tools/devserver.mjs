// Local dev server that mimics Vercel: serves public/ and runs api/*.js handlers.
//   node tools/devserver.mjs            -> real Gemini / Greenbook / NEAR (needs .env values)
//   MOCK=1 node tools/devserver.mjs     -> canned AI + in-memory NEAR contract (runs the real wasm)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (fs.existsSync('.env')) for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const MOCK = process.env.MOCK === '1';
const PORT = +process.env.PORT || 3000;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

let mock = null;
if (MOCK) {
  mock = await import('./mocks.mjs');
  mock.install();
  process.env.NEAR_CONTRACT_ID = 'verifynaija.testnet';
  process.env.NEAR_RPC_PUBLIC = `http://localhost:${PORT}/__rpc`;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();

  if (MOCK && url.pathname === '__rpc'.replace(/^/, '/')) {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(mock.rpc(JSON.parse(raw))));
  }
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z-]/g, '');
    const file = path.join(root, 'api', name + '.js');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('{}'); }
    const mod = await import(pathToFileURL(file).href);
    req.query = Object.fromEntries(url.searchParams);
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    const shim = Object.assign(res, {
      status(c) { res.statusCode = c; return shim; },
      json(o) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return shim; },
    });
    try { await mod.default(req, shim); } catch (e) { console.error(e); res.statusCode = 500; res.end('{"error":"server error"}'); }
    return;
  }
  let p = path.join(root, 'public', decodeURIComponent(url.pathname));
  if (p.endsWith('/') || (fs.existsSync(p) && fs.statSync(p).isDirectory())) p = path.join(p, 'index.html');
  if (!p.startsWith(path.join(root, 'public')) || !fs.existsSync(p)) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`VerifyNaija on http://localhost:${PORT}${MOCK ? ' (mock mode)' : ''}`));
