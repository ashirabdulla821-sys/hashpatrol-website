# HashPatrol login and registration (phone and email OTP)

A small server that lets visitors register and sign in with a one-time code sent to their mobile number or email.

**Status: starter code. I could not run it where it was written, so test it on your own computer before using it with real customers.**

## How it works

1. The visitor enters an email or a mobile number with country code.
2. The server creates a 6-digit code, stores only a hash of it, and sends it by SMS or email. The code expires in 5 minutes.
3. The visitor enters the code. After 5 wrong tries the code is cancelled.
4. If the email or number already has an account, the visitor is signed in. If not, an account is created and the visitor can add a name.
5. A secure sign-in cookie lasts 7 days.

Limits built in: 5 codes per hour for each email or number, 30 seconds between codes, and a cap on requests from each address.

## Run it on your computer

You need Node.js 18 or newer.

```
cd hashpatrol-auth
npm install
cp .env.example .env
```

Open `.env` and set `JWT_SECRET` and `OTP_SECRET` to two long random strings. The file shows the command to make them. Keep `DEV_LOG_OTP=true` while testing, so codes print in the terminal instead of being sent.

```
npm start
```

Open http://localhost:3000/login.html

## Turn on real SMS and email

- **SMS:** add your Twilio details (`TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`). To use MSG91 or another gateway, replace the `sendSms` function in `server.js` with that provider's API call. In India, SMS also needs DLT registration and an approved message template with your provider.
- **Email:** add the SMTP details from your email service (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`).

## Put it online at hashpatrol.com

1. Host the folder on a Node-capable service (for example Render, Railway or a VPS).
2. Set `NODE_ENV=production` and add all the `.env` values in the host's settings.
3. Use HTTPS only. The sign-in cookie is marked secure in production.
4. Keep `auth.db` on a persistent disk and back it up. It holds your customers' emails and numbers.
5. Point hashpatrol.com at the host. Serve the website and these pages from the same address so the cookie works.

## Before you collect real customer data

- Add a privacy policy and ask for consent before using emails or numbers for marketing.
- Collect only what you need.
- Add a way for people to delete their account. This starter does not have one yet.
- Consider adding a CAPTCHA to the "Send code" step to stop abuse.

## Files

- `server.js` – the server and its routes
- `public/login.html` – the sign-in and registration page
- `.env.example` – settings to copy into `.env`
- `package.json` – dependencies
