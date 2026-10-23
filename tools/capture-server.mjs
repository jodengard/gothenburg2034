// Tiny endpoint that receives base64 JPEG frames from the game page and saves them.
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  const name = new URL(req.url, 'http://x').pathname.slice(1).replace(/[^\w.-]/g, '') || 'shot.jpg';
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    writeFileSync(`C:/Users/Jockemon/AppData/Local/Temp/opencode/${name}`, Buffer.from(body, 'base64'));
    res.writeHead(200); res.end('ok');
  });
}).listen(8123, () => console.log('capture server on 8123'));
