import { spawnSync } from 'node:child_process';
import { serviceFailureLines } from './database-diagnostics.mjs';
// Failure-only CI helper. Raw output remains in memory and is never uploaded.
for (const name of ['supabase_rest_WTW-CSE416', 'supabase_db_WTW-CSE416']) {
  const result = spawnSync('docker', ['logs', '--since', '5m', '--tail', '200', name], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    console.log(name + ': diagnostics unavailable');
    continue;
  }
  const lines = serviceFailureLines((result.stdout ?? '') + '\n' + (result.stderr ?? ''));
  console.log(name + ': ' + (lines.length ? lines.join('\n') : 'no allowlisted failure events'));
}
