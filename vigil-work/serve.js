// local static server for checking VIGIL; serves the vigil/ folder. Logs every request so we can prove nothing carries inventory data.
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', 'vigil'), port = +process.env.PORT || 8767;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.xlsx': 'application/octet-stream', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  console.log(req.method, req.url, req.headers['content-length'] || 0);
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log('serving', root, 'on', port));
