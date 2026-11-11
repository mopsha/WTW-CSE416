import test from 'node:test';
import assert from 'node:assert/strict';
import {
  databaseFailureSummary,
  sanitizeDatabaseText,
  serviceFailureLines,
} from './database-diagnostics.mjs';
import { requireStatus } from './local.mjs';
test('reports actual PostgREST code/message/details/hint with bounded redaction', () => {
  const summary = JSON.parse(
    databaseFailureSummary({
      code: 'PGRST200',
      message: "Could not find a relationship between 'picks' and 'pick_candidates'",
      details: "Searched for a foreign key relationship using the hint 'picks_winner_is_candidate'",
      hint: "Perhaps you meant 'my_pick_summaries'",
      extra: 'not reported',
    }),
  );
  assert.equal(summary.code, 'PGRST200');
  assert.match(summary.message, /between 'picks' and 'pick_candidates'/);
  assert.match(summary.details, /'picks_winner_is_candidate'/);
  assert.match(summary.hint, /'my_pick_summaries'/);
  assert.equal(summary.extra, undefined);
  const timeout = { code: '57014', message: 'canceling statement due to statement timeout' };
  assert.throws(
    () => requireStatus({ status: 500, data: timeout }, 200, 'RPC', { database: true }),
    /57014.*canceling statement due to statement timeout/,
  );
  assert.throws(
    () => requireStatus({ status: 500, data: timeout }, 200, 'Auth'),
    (error) => !error.message.includes('57014'),
  );
});
test('redacts credentials, identifiers, SQL/context, row dumps and untrusted quoted values', () => {
  for (const secret of [
    'Authorization: Bearer sensitive',
    'apikey=private',
    'access_token=private',
    'refresh_token=private',
    'password=private',
    'jwt_secret=private',
    'eyJhbGciOiJIUzI1NiJ9.secret.signature',
    'sb_secret_veryPrivateKey',
    'user@example.com',
    'postgresql://user:private@localhost/db',
    'https://host/path?token=private',
    "invalid input syntax: 'private fixture'",
    'request.jwt.claims=private',
    "SQL statement: select set_config('private','private',true)",
    'Failing row contains (private fixture)',
  ]) {
    const result = databaseFailureSummary({
      code: 'XX000',
      message: secret,
      details: secret,
      hint: secret,
    });
    assert.ok(!result.includes(secret), secret);
    assert.ok(!result.includes('private fixture'));
  }
  assert.equal(sanitizeDatabaseText('x'.repeat(20000)), '[oversized diagnostic withheld]');
  assert.ok(sanitizeDatabaseText('x'.repeat(1000)).length <= 800);
  assert.equal(
    JSON.parse(databaseFailureSummary({ code: 'not_a_code', details: { access_token: 'secret' } }))
      .code,
    'unavailable',
  );
});
test('service logs emit only redacted errors and failing summary status, excluding SQL and headers', () => {
  const lines = serviceFailureLines(
    [
      'ERROR: canceling statement due to statement timeout',
      'STATEMENT: select private_credentials',
      'CONTEXT: request.jwt.claims = confidential',
      'Authorization: Bearer confidential',
      'DETAIL: access_token=confidential',
      'ERROR: password authentication failed for confidential',
      '127.0.0.1 "POST /rpc/my_pick_summaries?secret=confidential HTTP/1.1" 500 100',
      '127.0.0.1 "POST /rpc/my_pick_summaries HTTP/1.1" 200 100',
      '{"code":"XX000","message":"record type has not been registered","details":null,"access_token":"confidential"}',
    ].join('\n'),
  );
  assert.ok(lines.some((line) => line.includes('canceling statement due to statement timeout')));
  assert.ok(lines.some((line) => line.includes('record type has not been registered')));
  assert.ok(lines.includes('POST /rpc/my_pick_summaries HTTP 500'));
  assert.ok(!lines.join('\n').includes('confidential'));
  assert.ok(!lines.join('\n').includes('private_credentials'));
  assert.ok(!lines.join('\n').includes('HTTP 200'));
});
test('default Auth errors stay body-free and success returns the original payload unchanged', () => {
  const data = { access_token: 'private', refresh_token: 'private' };
  assert.equal(requireStatus({ status: 200, data }, 200, 'Auth'), data);
  assert.throws(
    () => requireStatus({ status: 500, data }, 200, 'Auth'),
    (error) => error.message === 'Auth: expected HTTP 200, received 500',
  );
});
