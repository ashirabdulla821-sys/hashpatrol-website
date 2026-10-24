// HashPatrol OTP login and registration (phone and email)
// Starter code. Test it on your own machine before going live.
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const { PORT = 3000, JWT_SECRET, OTP_SECRET, NODE_ENV } = process.env;
if (!JWT_SECRET || !OTP_SECRET) {
  console.error('Set JWT_SECRET and OTP_SECRET in your .env file.');
  process.exit(1);
}
const prod = NODE_ENV === 'production';

const db = new Database(process.env.DB_FILE || 'auth.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, email TEXT UNIQUE, phone TEXT UNIQUE,
    name TEXT, business TEXT, created_at INTEGER);
  CREATE TABLE IF NOT EXISTS otps (
    identifier TEXT PRIMARY KEY, code_hash TEXT, expires_at INTEGER,
    attempts INTEGER DEFAULT 0, sent_at INTEGER);
  CREATE TABLE IF NOT EXISTS sends (identifier TEXT, at INTEGER);
`);

const app = express();
if (prod) app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const ipLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });

// --- helpers ---------------------------------------------------------------
function normalize(raw) {
  const v = String(raw || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254) return { type: 'email', value: v.toLowerCase() };
  const p = v.replace(/[\s()-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(p)) return { type: 'phone', value: p };
  return null;
}
const hash = (code, id) => crypto.createHmac('sha256', OTP_SECRET).update(id + ':' + code).digest('hex');
const publicUser = (u) => ({ id: u.id, email: u.email, phone: u.phone, name: u.name, business: u.business });

function setSession(res, user) {
  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('hp_session', token, { httpOnly: true, sameSite: 'lax', secure: prod, maxAge: 7 * 24 * 3600 * 1000 });
}
function requireAuth(req, res, next) {
  try {
    const { sub } = jwt.verify(req.cookies.hp_session, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(sub);
    if (!user) throw new Error('no user');
    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Please sign in.' });
  }
}

// --- delivery: SMS (Twilio) and email (SMTP) --------------------------------
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

async function sendSms(to, text) {
  const { TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM } = process.env;
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return false;
  const body = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: text });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!r.ok) throw new Error('SMS provider returned ' + r.status);
  return true;
  // To use MSG91 or another gateway, replace this function with that provider's API call.
}

async function deliver(id, code) {
  const text = `Your HashPatrol code is ${code}. It expires in 5 minutes. Do not share it.`;
  let sent = false;
  if (id.type === 'phone') sent = await sendSms(id.value, text);
  else if (mailer) {
    await mailer.sendMail({ from: process.env.MAIL_FROM, to: id.value, subject: 'Your HashPatrol sign-in code', text });
    sent = true;
  }
  if (!sent) {
    if (prod || process.env.DEV_LOG_OTP !== 'true') throw new Error('No delivery provider configured');
    console.log(`[dev] code for ${id.value}: ${code}`);
  }
}

// --- routes ----------------------------------------------------------------
app.post('/api/auth/request-otp', ipLimiter, async (req, res) => {
  const id = normalize(req.body && req.body.identifier);
  if (!id) return res.status(400).json({ error: 'Enter a valid email, or a phone number with country code such as +919876543210.' });
  const now = Date.now();
  db.prepare('DELETE FROM sends WHERE at < ?').run(now - 3600e3);
  if (db.prepare('SELECT COUNT(*) c FROM sends WHERE identifier = ?').get(id.value).c >= 5)
    return res.status(429).json({ error: 'Too many codes requested. Try again in an hour.' });
  const last = db.prepare('SELECT sent_at FROM otps WHERE identifier = ?').get(id.value);
  if (last && now - last.sent_at < 30000)
    return res.status(429).json({ error: 'Wait 30 seconds before asking for another code.' });

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.prepare('INSERT OR REPLACE INTO otps (identifier, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)')
    .run(id.value, hash(code, id.value), now + 5 * 60e3, now);
  db.prepare('INSERT INTO sends VALUES (?, ?)').run(id.value, now);
  try {
    await deliver(id, code);
  } catch (e) {
    console.error('Delivery failed:', e.message);
    return res.status(502).json({ error: 'Could not send the code. Try again later.' });
  }
  res.json({ ok: true });
});

app.post('/api/auth/verify-otp', ipLimiter, (req, res) => {
  const id = normalize(req.body && req.body.identifier);
  const code = String((req.body && req.body.code) || '').trim();
  if (!id || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code.' });

  const row = db.prepare('SELECT * FROM otps WHERE identifier = ?').get(id.value);
  if (!row || row.expires_at < Date.now()) return res.status(400).json({ error: 'The code expired. Ask for a new one.' });
  if (row.attempts >= 5) {
    db.prepare('DELETE FROM otps WHERE identifier = ?').run(id.value);
    return res.status(429).json({ error: 'Too many wrong tries. Ask for a new code.' });
  }
  db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE identifier = ?').run(id.value);
  const a = Buffer.from(hash(code, id.value));
  const b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).json({ error: 'That code is not right.' });
  db.prepare('DELETE FROM otps WHERE identifier = ?').run(id.value);

  // Link to an existing account, or create a new one
  let user = db.prepare(`SELECT * FROM users WHERE ${id.type} = ?`).get(id.value);
  let isNew = false;
  if (!user) {
    const name = String((req.body && req.body.name) || '').trim().slice(0, 80) || null;
    const r = db.prepare('INSERT INTO users (email, phone, name, created_at) VALUES (?, ?, ?, ?)')
      .run(id.type === 'email' ? id.value : null, id.type === 'phone' ? id.value : null, name, Date.now());
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
    isNew = true;
  }
  setSession(res, user);
  res.json({ user: publicUser(user), isNew });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/profile', requireAuth, (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 80) || null;
  const business = String((req.body && req.body.business) || '').trim().slice(0, 120) || null;
  db.prepare('UPDATE users SET name = ?, business = ? WHERE id = ?').run(name, business, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('hp_session');
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`HashPatrol auth running on http://localhost:${PORT}`));
