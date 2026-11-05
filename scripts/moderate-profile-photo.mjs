// Privileged operator tool, never bundled into the app. Uses existing service-role
// credentials; never emits tokens, paths, server error bodies, or signed URLs.
import { open } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

const [action, reportId, output] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mode = process.env.WTW_MODERATION_MODE;
const expectedRef = process.env.WTW_MODERATION_EXPECTED_PROJECT_REF;
let origin;
let requestHeaders;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function request(path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    headers: requestHeaders,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Moderation operation failed (HTTP ${response.status})`);
  return response;
}
try {
  if (
    !url ||
    !key ||
    !uuid.test(reportId ?? '') ||
    !['view', 'remove'].includes(action) ||
    (action === 'view' && !output) ||
    (action === 'remove' && output !== '--confirm')
  )
    throw new Error(
      'Usage: view <report UUID> <new private JPEG path> | remove <report UUID> --confirm; set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  if (process.argv.slice(2).length !== 3)
    throw new Error('Operator configuration: expected exactly three command arguments');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Operator configuration: invalid API URL');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/')
    throw new Error(
      'Operator configuration: expected an API origin without credentials, path, query or fragment',
    );
  if (mode === 'hosted') {
    if (
      !expectedRef ||
      !/^[a-z0-9]{20}$/.test(expectedRef) ||
      parsed.origin !== `https://${expectedRef}.supabase.co`
    )
      throw new Error(
        'Operator configuration: destination does not match the separately approved project reference',
      );
  } else if (mode === 'local') {
    if (
      expectedRef ||
      !['http://127.0.0.1:54321', 'http://localhost:54321'].includes(parsed.origin)
    )
      throw new Error(
        'Operator configuration: local mode requires loopback port 54321 and no hosted project reference',
      );
  } else {
    throw new Error(
      'Operator configuration: explicitly select WTW_MODERATION_MODE=hosted or local',
    );
  }
  origin = parsed.origin;
  requestHeaders = { apikey: key, 'Content-Type': 'application/json' };
  if (/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(key)) {
    // Modern secret keys are API keys, not JWTs.
  } else if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    let claims;
    try {
      claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    } catch {
      throw new Error('Operator configuration: unsupported privileged credential format');
    }
    // This is an input guard, not signature verification: Supabase still authenticates it.
    if (
      claims?.role !== 'service_role' ||
      (mode === 'hosted' && claims.ref && claims.ref !== expectedRef)
    )
      throw new Error(
        'Operator configuration: expected a service-role credential for the approved project',
      );
    requestHeaders.Authorization = `Bearer ${key}`;
  } else {
    throw new Error('Operator configuration: unsupported privileged credential format');
  }
  if (action === 'remove') {
    await request('/rest/v1/rpc/avatar_moderation_remove', { p_report_id: reportId });
    console.log('Removed the reported current photo; report marked reviewed.');
  } else {
    const path = await (
      await request('/rest/v1/rpc/avatar_moderation_evidence', { p_report_id: reportId })
    ).json();
    if (typeof path !== 'string' || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/.test(path))
      throw new Error('Invalid evidence reference');
    const response = await request(`/storage/v1/object/authenticated/profile-photos/${path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 1048576) throw new Error('Invalid evidence image size');
    const file = await open(output, 'wx', 0o600);
    try {
      await file.writeFile(bytes);
    } finally {
      await file.close();
    }
    console.log('Evidence saved privately. Delete the local copy after review under team policy.');
  }
} catch (error) {
  // Even fetch exceptions may contain sensitive URL/context. Only our fixed errors are printed.
  console.error(
    error instanceof Error &&
      /^(Usage:|Operator configuration:|Moderation operation failed|Invalid evidence)/.test(
        error.message,
      )
      ? error.message
      : 'Moderation operation failed; no private diagnostic details emitted.',
  );
  process.exitCode = 1;
}
