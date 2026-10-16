const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { fetchImage, isPrivateIp, hostAllowed, sniff } = require('../src/services/imageFetch');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
let srv, port;
test.before(async () => {
  srv = http.createServer((req, res) => {
    if (req.url === '/ok.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
    if (req.url === '/svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>' + ' '.repeat(40)); }
    if (req.url === '/big') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])); }
    if (req.url === '/redir-evil') { res.writeHead(302, { Location: 'http://evil.example/x.png' }); return res.end(); }
    if (req.url === '/redir-meta') { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }); return res.end(); }
    if (req.url === '/redir-ok') { res.writeHead(302, { Location: '/ok.png' }); return res.end(); }
    if (req.url === '/slow') return; // never answers
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); port = srv.address().port;
});
test.after(() => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(); });

const dev = { allowedDomains: ['localhost'], allowHttp: true, allowPrivate: true };   // dev switches so the local test server is reachable
const url = (p) => `http://localhost:${port}${p}`;

test('isPrivateIp covers loopback, RFC1918, link-local/metadata, CGNAT, IPv6 and mapped forms', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});
test('hostAllowed: own domain + subdomains + admin CDN list only; never IPs or look-alikes', () => {
  assert.ok(hostAllowed('shop.example.com', ['example.com'])); assert.ok(hostAllowed('example.com', ['example.com']));
  assert.ok(hostAllowed('cdn.shopify.com', ['example.com'], ['cdn.shopify.com']));
  assert.equal(hostAllowed('evilexample.com', ['example.com']), false);
  assert.equal(hostAllowed('example.com.evil.net', ['example.com']), false);
  assert.equal(hostAllowed('127.0.0.1', ['127.0.0.1']), false);
});
test('sniff recognises real image bytes and rejects svg/html', () => {
  assert.equal(sniff(PNG), 'image/png'); assert.equal(sniff(Buffer.from('<svg xmlns="x"></svg>....')), null); assert.equal(sniff(Buffer.from('<html><body>hi</body></html>')), null);
});
test('fetches a valid image (dev switches)', async () => { const r = await fetchImage(url('/ok.png'), dev); assert.equal(r.mime, 'image/png'); });
test('follows a same-host redirect', async () => assert.equal((await fetchImage(url('/redir-ok'), dev)).mime, 'image/png'));
test('SSRF: loopback is blocked by default even if the hostname is "allowed"', async () => {
  await assert.rejects(fetchImage(url('/ok.png'), { allowedDomains: ['localhost'], allowHttp: true }), (e) => e.code === 'BLOCKED_ADDRESS' || e.code === 'BAD_URL');
});
test('SSRF: https required in production mode', async () => { await assert.rejects(fetchImage(url('/ok.png'), { allowedDomains: ['localhost'] }), (e) => e.code === 'BAD_URL'); });
test('SSRF: redirect to a non-allowed host is refused', async () => { await assert.rejects(fetchImage(url('/redir-evil'), dev), (e) => e.code === 'HOST_NOT_ALLOWED'); });
test('SSRF: redirect to the cloud metadata IP is refused', async () => { await assert.rejects(fetchImage(url('/redir-meta'), dev), (e) => e.code === 'HOST_NOT_ALLOWED'); });
test('host not on the client allow-list is refused', async () => { await assert.rejects(fetchImage('https://example.org/a.png', { allowedDomains: ['example.com'] }), (e) => e.code === 'HOST_NOT_ALLOWED'); });
test('SVG content is rejected', async () => { await assert.rejects(fetchImage(url('/svg'), dev), (e) => e.code === 'BAD_TYPE'); });
test('size cap enforced', async () => { await assert.rejects(fetchImage(url('/big'), { ...dev, maxBytes: 1024 * 1024 }), (e) => e.code === 'TOO_LARGE'); });
test('timeout enforced', async () => { await assert.rejects(fetchImage(url('/slow'), { ...dev, timeoutMs: 400 }), (e) => e.code === 'TIMEOUT' || /timed out/i.test(e.message)); });
test('credentials in URL refused', async () => { await assert.rejects(fetchImage('https://user:pw@example.com/a.png', { allowedDomains: ['example.com'] }), (e) => e.code === 'BAD_URL'); });
