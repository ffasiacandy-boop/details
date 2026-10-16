// SSRF-hardened image fetcher used by POST /api/image/fetch (only for images the browser cannot read itself, i.e. no CORS).
// Defences: https only; ports 80/443 only; host must belong to the client's allowed domains (or an admin-configured CDN list);
// DNS is resolved by OUR lookup and every address checked (blocks private/loopback/link-local/metadata, defeats DNS rebinding
// because the connection uses the vetted address); redirects followed manually and re-validated; size, time and MIME limits;
// content is sniffed by magic bytes (SVG/HTML rejected).
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');

function ipv4Private(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return ipv4Private(ip);
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v); if (m) return ipv4Private(m[1]);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(v)) return true;      // hex-form mapped addresses: refuse
    return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v) || /^64:ff9b:/.test(v) || /^2001:db8/.test(v);
  }
  return true;
}

const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);
/** host must equal/sub-domain one of the client's domains, or be on the admin CDN list. */
function hostAllowed(host, allowedDomains = [], extraHosts = []) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h || net.isIP(h)) return false;                                      // bare IPs are never allowed
  return [...allowedDomains, ...extraHosts].some((d) => d && hostMatches(h, String(d).toLowerCase()));
}

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (buf.slice(4, 12).toString('latin1') === 'ftypavif') return 'image/avif';
  return null;
}

class FetchError extends Error { constructor(code, message) { super(message); this.code = code; } }

function safeLookup(allowPrivate) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    dns.lookup(hostname, { all: true }, (err, addrs) => {
      if (err) return cb(err);
      const good = addrs.filter((a) => allowPrivate || !isPrivateIp(a.address));
      if (!good.length) return cb(new FetchError('BLOCKED_ADDRESS', 'Destination address is not allowed.'));
      if (options && options.all) return cb(null, good);
      return cb(null, good[0].address, good[0].family);
    });
  };
}

function once(urlObj, { timeoutMs, allowPrivate }) {
  return new Promise((resolve, reject) => {
    const lib = urlObj.protocol === 'https:' ? https : http;
    const req = lib.request(urlObj, { method: 'GET', lookup: safeLookup(allowPrivate), timeout: timeoutMs, headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5', 'User-Agent': 'VirtualTryOn-ImageFetch/1.0' }, agent: false }, resolve);
    req.on('timeout', () => req.destroy(new FetchError('TIMEOUT', 'Upstream timed out.')));
    req.on('error', reject); req.end();
  });
}

/**
 * @param {string} rawUrl
 * @param {{allowedDomains:string[], extraHosts?:string[], maxBytes?:number, timeoutMs?:number, maxRedirects?:number, allowHttp?:boolean, allowPrivate?:boolean}} o
 * @returns {Promise<{buffer:Buffer, mime:string, finalUrl:string}>}
 */
async function fetchImage(rawUrl, o) {
  const maxBytes = o.maxBytes || 8 * 1024 * 1024, timeoutMs = o.timeoutMs || 8000, maxRedirects = o.maxRedirects === undefined ? 3 : o.maxRedirects;
  let url;
  try { url = new URL(rawUrl); } catch { throw new FetchError('BAD_URL', 'Invalid URL.'); }
  const started = Date.now();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!(url.protocol === 'https:' || (o.allowHttp && url.protocol === 'http:'))) throw new FetchError('BAD_URL', 'Only https URLs are allowed.');
    if (url.username || url.password) throw new FetchError('BAD_URL', 'Credentials in URLs are not allowed.');
    if (url.port && !['80', '443'].includes(url.port) && !o.allowPrivate) throw new FetchError('BAD_URL', 'Port not allowed.');
    if (!hostAllowed(url.hostname, o.allowedDomains, o.extraHosts)) throw new FetchError('HOST_NOT_ALLOWED', 'Image host is not permitted for this client.');
    const remaining = timeoutMs - (Date.now() - started); if (remaining <= 0) throw new FetchError('TIMEOUT', 'Upstream timed out.');
    const res = await once(url, { timeoutMs: remaining, allowPrivate: !!o.allowPrivate });
    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      res.resume();
      if (!res.headers.location) throw new FetchError('BAD_UPSTREAM', 'Redirect without location.');
      try { url = new URL(res.headers.location, url); } catch { throw new FetchError('BAD_URL', 'Invalid redirect.'); }
      continue;                                                              // next loop iteration re-validates scheme, port and host
    }
    if (res.statusCode !== 200) { res.resume(); throw new FetchError('BAD_UPSTREAM', `Upstream returned ${res.statusCode}.`); }
    const declared = Number(res.headers['content-length']); if (declared > maxBytes) { res.destroy(); throw new FetchError('TOO_LARGE', 'Image too large.'); }
    const chunks = []; let size = 0;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { res.destroy(); reject(new FetchError('TIMEOUT', 'Upstream timed out.')); }, Math.max(1, timeoutMs - (Date.now() - started)));
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { res.destroy(); clearTimeout(timer); reject(new FetchError('TOO_LARGE', 'Image too large.')); } else chunks.push(c); });
      res.on('end', () => { clearTimeout(timer); resolve(); }); res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    const buffer = Buffer.concat(chunks), mime = sniff(buffer);
    if (!mime) throw new FetchError('BAD_TYPE', 'Not a supported image type (jpeg, png, webp, gif, avif).');
    return { buffer, mime, finalUrl: url.href };
  }
  throw new FetchError('TOO_MANY_REDIRECTS', 'Too many redirects.');
}

module.exports = { fetchImage, isPrivateIp, hostAllowed, sniff, FetchError };
