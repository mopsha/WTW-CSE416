const { Buffer } = jest.requireActual('node:buffer');
const { spawnSync } = jest.requireActual('node:child_process');
const { mkdtempSync, readFileSync, rmSync, statSync } = jest.requireActual('node:fs');
const { tmpdir } = jest.requireActual('node:os');
const { join, resolve } = jest.requireActual('node:path');
const reportId = '11111111-1111-4111-8111-111111111111';
const objectPath = `${reportId}/${reportId}.jpg`;
const script = resolve('scripts/moderate-profile-photo.mjs');
const projectRef = 'abcdefghijklmnopqrst'; // Fictional test project, never contacted.
const modern = 'sb_secret_TEST_SERVICE_SECRET_1234567890';
const legacy = [
  'e30',
  Buffer.from(JSON.stringify({ role: 'service_role', ref: projectRef })).toString('base64url'),
  'synthetic_signature',
].join('.');
function run(
  args: string[],
  overrides: Record<string, string | undefined> = {},
  fail = false,
  changeDuringRead = false,
) {
  const credential = overrides.SUPABASE_SERVICE_ROLE_KEY ?? modern;
  const stub = `process.argv = ['node', ${JSON.stringify(script)}, ...${JSON.stringify(args)}];
    let calls=0, currentReads=0;
    globalThis.fetch = async (url, options) => {
      calls++;
      if (options.headers.apikey !== ${JSON.stringify(credential)} ||
          options.headers.Authorization !== ${JSON.stringify(credential === legacy ? `Bearer ${legacy}` : undefined)})
        throw Error('Header mismatch');
      if (${fail}) return new Response('PRIVATE_SERVER_DETAILS', {status:403});
      if (url.includes('avatar_moderation_current')) {
        currentReads++;
        return Response.json({userId:${JSON.stringify(reportId)},revision:(${changeDuringRead} && currentReads>1)?8:7,path:${JSON.stringify(objectPath)}});
      }
      if (url.includes('avatar_moderation_remove_current')) {
        const input=JSON.parse(options.body);
        if (input.p_revision!==7 || input.p_path!==${JSON.stringify(objectPath)}) throw Error('Current verification binding mismatch');
        return Response.json({revision:8,resolvedReports:2});
      }
      if (url.includes('avatar_moderation_evidence')) return Response.json(${JSON.stringify(objectPath)});
      if (url.includes('/storage/')) return new Response(new Uint8Array([255,216,255,217]));
      if (url.includes('avatar_moderation_remove')) return Response.json({revision:8});
      throw Error('Unexpected request');
    };
    await import(${JSON.stringify('file://' + script)});
    process.stdout.write('\\nTEST_NETWORK_CALLS='+calls);`;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', stub], {
    env: {
      ...process.env,
      SUPABASE_URL: `https://${projectRef}.supabase.co/`,
      SUPABASE_SERVICE_ROLE_KEY: modern,
      WTW_MODERATION_MODE: 'hosted',
      WTW_MODERATION_EXPECTED_PROJECT_REF: projectRef,
      ...overrides,
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
}
test.each([modern, legacy])(
  'operator tool supports privileged key format without logging credentials: %s',
  (key) => {
    const result = run(['remove', reportId, '--confirm'], { SUPABASE_SERVICE_ROLE_KEY: key });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('TEST_NETWORK_CALLS=1');
    expect(result.stdout).not.toContain(key);
    expect(result.stderr).not.toContain(key);
  },
);
test('view creates an exclusive private file and removal requires confirmation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtw-moderation-test-'));
  try {
    const file = join(dir, 'evidence.jpg');
    expect(run(['view', reportId, file]).status).toBe(0);
    expect(readFileSync(file).length).toBe(4);
    expect(statSync(file).mode & 0o077).toBe(0);
    expect(run(['view', reportId, file]).status).not.toBe(0);
    const unconfirmed = run(['remove', reportId]);
    expect(unconfirmed.status).not.toBe(0);
    expect(unconfirmed.stdout).toContain('TEST_NETWORK_CALLS=0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test.each([
  { SUPABASE_URL: 'https://zyxwvutsrqponmlkjihg.supabase.co' },
  { SUPABASE_URL: 'https://untrusted.example' },
  { SUPABASE_URL: `https://${projectRef}.supabase.co.untrusted.example` },
  { SUPABASE_URL: 'http://127.0.0.1:54321' },
  { SUPABASE_URL: `https://${projectRef}.supabase.co:444` },
  { SUPABASE_URL: `http://${projectRef}.supabase.co` },
  { SUPABASE_URL: 'not a URL' },
  { SUPABASE_URL: `https://user:password@${projectRef}.supabase.co` },
  { SUPABASE_URL: `https://${projectRef}.supabase.co/other` },
  { SUPABASE_URL: `https://${projectRef}.supabase.co?token=private` },
  { WTW_MODERATION_EXPECTED_PROJECT_REF: '' },
  { WTW_MODERATION_MODE: '' },
  { SUPABASE_SERVICE_ROLE_KEY: 'unsupported-private-key' },
  { SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_PRIVATE_TEST_VALUE' },
  { SUPABASE_SERVICE_ROLE_KEY: 'abc.invalid.abc' },
  { WTW_MODERATION_MODE: 'local' },
  {
    WTW_MODERATION_MODE: 'local',
    WTW_MODERATION_EXPECTED_PROJECT_REF: '',
    SUPABASE_URL: 'http://localhost:8888',
  },
])('invalid destination or credential sends no network requests: %j', (overrides) => {
  const result = run(['remove', reportId, '--confirm'], overrides);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain('TEST_NETWORK_CALLS=0');
  expect(result.stderr).toContain('Operator configuration:');
  expect(result.stderr).not.toContain(modern);
  expect(result.stderr).not.toContain(overrides.SUPABASE_SERVICE_ROLE_KEY ?? modern);
});
test('local mode must be explicitly selected and cannot carry a hosted reference', () => {
  const result = run(['remove', reportId, '--confirm'], {
    WTW_MODERATION_MODE: 'local',
    WTW_MODERATION_EXPECTED_PROJECT_REF: '',
    SUPABASE_URL: 'http://127.0.0.1:54321',
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('TEST_NETWORK_CALLS=1');
});
test.each([modern, legacy])(
  'upstream failures sanitize response bodies and both credential formats',
  (key) => {
    const result = run(['remove', reportId, '--confirm'], { SUPABASE_SERVICE_ROLE_KEY: key }, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('HTTP 403');
    for (const secret of [key, objectPath, 'PRIVATE_SERVER_DETAILS'])
      expect(result.stderr).not.toContain(secret);
  },
);

test('current-photo review rechecks after downloading and current removal binds the verified revision', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtw-current-review-'));
  try {
    const file = join(dir, 'current.jpg');
    const viewed = run(['view-current', reportId, file]);
    expect(viewed.status).toBe(0);
    expect(viewed.stdout).toContain('TEST_NETWORK_CALLS=3');
    const changed = join(dir, 'changed.jpg');
    const result = run(['view-current', reportId, changed], {}, false, true);
    expect(result.status).not.toBe(0);
    expect(() => readFileSync(changed)).toThrow();
    const removed = run(['remove-current', reportId, '--confirm']);
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain('resolved reports 2');
    const unconfirmed = run(['remove-current', reportId]);
    expect(unconfirmed.status).not.toBe(0);
    expect(unconfirmed.stdout).toContain('TEST_NETWORK_CALLS=0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
