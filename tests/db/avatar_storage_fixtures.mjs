// Storage fixtures for the SQL concurrency test. Use the supported API for both
// creation and removal; never bypass Storage's metadata deletion protections.
import { readFile } from 'node:fs/promises';
import { localConfig, request, requireStatus } from '../api/local.mjs';

const [action, ...paths] = process.argv.slice(2);
if (
  !['create', 'remove'].includes(action) ||
  paths.length !== 2 ||
  paths.some((path) => !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/.test(path))
) {
  throw new Error('Expected fixture action and two generated photo paths');
}
const config = localConfig(); // Fixed loopback ports only; credentials stay in memory.
if (action === 'create') {
  const bytes = await readFile(new URL('../api/avatar-fixture.jpg', import.meta.url));
  for (const path of paths) {
    const response = await fetch(`${config.url}/storage/v1/object/profile-photos/${path}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        apikey: config.service,
        Authorization: `Bearer ${config.service}`,
        'Content-Type': 'image/jpeg',
      },
      body: bytes,
    });
    // Never print response bodies or credentials.
    if (response.status !== 200) throw new Error(`Photo fixture upload: HTTP ${response.status}`);
    await response.arrayBuffer();
  }
} else {
  requireStatus(
    await request(config, '/storage/v1/object/profile-photos', {
      method: 'DELETE',
      key: config.service,
      token: config.service,
      body: { prefixes: paths },
    }),
    200,
    'Photo fixture cleanup',
  );
}
