import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import authRouter from '../dist/routes/auth.js';

test('malformed password sign-in and registration return validation errors before database access', async (t) => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/auth', authRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const path of ['/auth/register', '/auth/login']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid-email', password: 12 }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(typeof body.error, 'string');
    assert.ok(body.error.length > 0);
  }
});

test('direct Google OAuth start signs state, validates allowed redirect origins, and callback rejects tampered state', async (t) => {
  const prevClientId = process.env.GOOGLE_CLIENT_ID;
  const prevRedirectUri = process.env.GOOGLE_REDIRECT_URI;
  process.env.GOOGLE_CLIENT_ID = '1090833690992-test.apps.googleusercontent.com';
  process.env.GOOGLE_REDIRECT_URI = 'https://crypto.auraajenticai.cloud/api/auth/google/callback';
  t.after(() => {
    if (prevClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prevClientId;
    if (prevRedirectUri === undefined) delete process.env.GOOGLE_REDIRECT_URI;
    else process.env.GOOGLE_REDIRECT_URI = prevRedirectUri;
  });

  const app = express();
  app.use('/auth', authRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));

  const startRes = await fetch(
    `http://127.0.0.1:${server.address().port}/auth/google/start?redirect=${encodeURIComponent('https://cryptotradeanalysis.vercel.app')}`,
    { redirect: 'manual' }
  );
  assert.equal(startRes.status, 302);
  const location = startRes.headers.get('location');
  assert.ok(location?.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  const authUrl = new URL(location);
  assert.equal(authUrl.searchParams.get('client_id'), '1090833690992-test.apps.googleusercontent.com');
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://crypto.auraajenticai.cloud/api/auth/google/callback');
  assert.equal(authUrl.searchParams.get('response_type'), 'code');
  const signedState = authUrl.searchParams.get('state') || '';
  assert.ok(signedState.includes('.'));

  const untrustedStartRes = await fetch(
    `http://127.0.0.1:${server.address().port}/auth/google/start?redirect=${encodeURIComponent('https://evil.example.com')}`,
    { redirect: 'manual' }
  );
  assert.equal(untrustedStartRes.status, 302);
  const untrustedStatePayload = JSON.parse(
    Buffer.from(new URL(untrustedStartRes.headers.get('location')).searchParams.get('state').split('.')[0], 'base64url').toString('utf8')
  );
  assert.equal(untrustedStatePayload.redirectTo, 'https://crypto.auraajenticai.cloud');

  const badCallbackRes = await fetch(
    `http://127.0.0.1:${server.address().port}/auth/google/callback?code=fake&state=${encodeURIComponent(`${signedState}tampered`)}`,
    { redirect: 'manual' }
  );
  assert.equal(badCallbackRes.status, 302);
  assert.ok(badCallbackRes.headers.get('location')?.startsWith('https://crypto.auraajenticai.cloud/?auth_error='));
});
