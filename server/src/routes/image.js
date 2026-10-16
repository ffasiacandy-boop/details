const express = require('express');
const db = require('../db');
const logger = require('../utils/logger');
const { fail, wrap } = require('../utils/respond');
const { validatePublic } = require('../services/license');
const { normalizeDomain } = require('../utils/validate');
const { fetchImage, FetchError } = require('../services/imageFetch');

const r = express.Router();
const extraHosts = (process.env.IMAGE_PROXY_EXTRA_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);   // e.g. cdn.shopify.com
const cache = new Map();                                    // tiny in-memory LRU: url -> { buffer, mime, at }
const CACHE_MAX = 40, CACHE_TTL = 10 * 60 * 1000;

// POST /api/image/fetch { license, domain, url }  -> image bytes. Same licence + domain checks as /api/license/validate.
r.post('/fetch', wrap(async (req, res) => {
  const b = req.body || {};
  const v = validatePublic({ license: b.license, domain: b.domain, origin: req.get('origin'), ip: req.ip });
  if (!v.ok) return fail(res, 403, v.code, 'Virtual Try-On is currently unavailable.');
  if (typeof b.url !== 'string' || b.url.length > 2000) return fail(res, 400, 'BAD_URL', 'Invalid image URL.');

  const lic = db.prepare('SELECT client_id FROM licenses WHERE license_key = ?').get(String(b.license).trim().toLowerCase());
  const allowedDomains = db.prepare('SELECT domain FROM domains WHERE client_id = ? AND verified = 1').all(lic.client_id).map((d) => normalizeDomain(d.domain)).filter(Boolean);

  let hit = cache.get(b.url);
  if (hit && Date.now() - hit.at > CACHE_TTL) { cache.delete(b.url); hit = null; }
  if (!hit) {
    try { hit = { ...(await fetchImage(b.url, { allowedDomains, extraHosts, allowHttp: process.env.NODE_ENV !== 'production' && process.env.IMAGE_PROXY_ALLOW_HTTP === 'true' })), at: Date.now() }; }
    catch (e) {
      logger.warn('image_fetch_rejected', { domain: b.domain, code: e.code || 'ERROR' });
      const known = e instanceof FetchError;
      return fail(res, known && e.code === 'HOST_NOT_ALLOWED' ? 403 : 422, known ? e.code : 'FETCH_FAILED', known ? e.message : 'Could not load the image.');
    }
    cache.set(b.url, hit); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  res.set({ 'Content-Type': hit.mime, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  return res.status(200).send(hit.buffer);
}));

module.exports = r;
