// Local-only, in-memory integration preview. No production data or credentials.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, sep, extname} from 'node:path';
import {createHandler} from '../netlify/analytics-service.mjs';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const keys = new Set();
const handler = createHandler(() => ({
  async set(key) { keys.add(key); },
  async *list({prefix}) { yield {blobs:[...keys].filter(key => key.startsWith(prefix)).map(key => ({key}))}; },
}));
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://127.0.0.1:8767');
    if (url.pathname === '/.netlify/functions/manille-analytics') {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 1024) {res.writeHead(413).end(); return;} chunks.push(chunk); }
      const request = new Request(url,{method:req.method, headers:req.headers,
        ...(['GET','HEAD'].includes(req.method) ? {} : {body:Buffer.concat(chunks)})});
      const response = await handler(request);
      res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    const path = resolve(root,'.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(resolve(root) + sep)) {res.writeHead(403).end(); return;}
    const data = await readFile(path);
    res.writeHead(200,{'Content-Type':({'.mjs':'text/javascript','.css':'text/css','.html':'text/html'}[extname(path)] || 'application/octet-stream') + '; charset=utf-8','Cache-Control':'no-store'});
    res.end(data);
  } catch {res.writeHead(404).end();}
});
server.listen(8767,'127.0.0.1',() => console.log('Analytics test preview: http://127.0.0.1:8767 (memory only; resets when stopped)'));
