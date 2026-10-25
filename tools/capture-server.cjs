// Tiny capture sink: POST raw base64 JPEG body to /<name>.jpg -> saves to temp dir.
const http = require('http');
const fs = require('fs');
const path = require('path');
const OUT = 'C:\\Users\\Jockemon\\AppData\\Local\\Temp\\opencode';
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end('no'); return; }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const name = path.basename(req.url).replace(/[^a-z0-9._-]/gi, '_') || 'shot.jpg';
    try {
      fs.writeFileSync(path.join(OUT, name), Buffer.from(body, 'base64'));
      res.writeHead(200); res.write('ok ' + name); res.end();
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
}).listen(8123, () => console.log('capture on 8123'));
