import { gzipSync } from 'node:zlib';

const BODY_LIMIT = 100_000;
const FORM_LIMIT = 20_000;

// Throw this from a handler. The client receives { error: message } with this status.
// Anything thrown without a status becomes a 500 with generic copy and is logged.
export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function sendJson(res, status, body, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  };
  const accept = String(res.req?.headers['accept-encoding'] || '');
  const gzip = payload.length >= 800 && /\bgzip\b/.test(accept) && !headers['Content-Encoding'] ? gzipSync(payload, { level: 6 }) : null;
  const encoded = gzip && gzip.length < payload.length ? gzip : payload;
  if (encoded !== payload) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = headers.Vary ? `${headers.Vary}, Accept-Encoding` : 'Accept-Encoding';
  }
  headers['Content-Length'] = encoded.length;
  res.writeHead(status, headers);
  res.end(encoded);
}

// A download. Always an attachment and never cached, so a stored file is never shown inline.
export function sendFile(res, { body, contentType, filename, status = 200 }) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

// A small page for a person's browser, such as the sign-in callback when it refuses a token.
export function sendHtml(res, status, html, extraHeaders = {}) {
  const body = Buffer.from(html);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders,
  });
  res.end(body);
}

export function readJson(req, { limit = BODY_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    function fail(status, message) {
      if (settled) return;
      settled = true;
      reject(httpError(status, message));
    }

    // Past the limit the rest is read and discarded rather than destroying the socket,
    // so the 413 still reaches the client.
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        fail(413, 'Payload too large');
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        settled = true;
        resolve({});
        return;
      }
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') {
        fail(415, 'Content-Type must be application/json');
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          fail(400, 'JSON body must be an object');
          return;
        }
        settled = true;
        resolve(parsed);
      } catch {
        fail(400, 'Invalid JSON');
      }
    });

    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

// A browser form post (application/x-www-form-urlencoded). Every value is a string.
export function readForm(req, { limit = FORM_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    function fail(status, message) {
      if (settled) return;
      settled = true;
      reject(httpError(status, message));
    }

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        fail(413, 'Payload too large');
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/x-www-form-urlencoded') {
        fail(415, 'Content-Type must be application/x-www-form-urlencoded');
        return;
      }
      settled = true;
      resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    });

    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}
