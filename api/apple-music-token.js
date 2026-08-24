import { createSign } from 'node:crypto';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
let cached = null;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function hostOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return host ? `${proto}://${host}` : '';
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const configured = process.env.APPLE_MUSIC_ORIGIN;
  return origin === (configured || hostOrigin(req));
}

function createDeveloperToken() {
  const teamId = String(process.env.APPLE_MUSIC_TEAM_ID || '').trim();
  const keyId = String(process.env.APPLE_MUSIC_KEY_ID || '').trim();
  const privateKey = String(process.env.APPLE_MUSIC_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!teamId || !keyId || !privateKey) {
    const err = new Error('Apple Music server credentials are not configured');
    /* Missing configuration is permanent until someone sets the env vars, not
       a transient outage. Saying 503 invites the client to try again on every
       interaction, which on a phone is a wasted round trip over cellular each
       time. 501 says plainly that this deployment does not implement it. */
    err.permanent = true;
    throw err;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign('SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { token: `${unsigned}.${signature}`, expiresAt: (now + TOKEN_TTL_SECONDS) * 1000 };
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!isAllowedOrigin(req)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  try {
    if (!cached || cached.expiresAt - Date.now() < 60 * 60 * 1000) cached = createDeveloperToken();
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json(cached);
  } catch (err) {
    const permanent = err && err.permanent === true;
    res.status(permanent ? 501 : 503).json({
      error: err.message || 'Apple Music token unavailable',
      configured: !permanent,
    });
  }
}
