import { setTimeout } from 'node:timers/promises';
import { localConfig, request } from './local.mjs';

const config = localConfig();
const deadline = Date.now() + 90_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await request(config, '/functions/v1/api/health');
    if (response.status === 200 && response.data?.status === 'ok') {
      ready = true;
      break;
    }
  } catch {
    /* Retry until bounded deadline; no raw errors or service logs. */
  }
  await setTimeout(1000);
}
if (!ready) throw new Error('Local API did not become healthy within the readiness window');
console.log('Local API is ready');
