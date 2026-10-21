import { execFileSync } from 'node:child_process';

/** Obtain only local CLI credentials in memory; never echo CLI output or tokens. */
export function localConfig() {
  let status;
  try {
    status = JSON.parse(
      execFileSync('supabase', ['status', '-o', 'json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15_000,
      }),
    );
  } catch {
    throw new Error('Local Supabase status unavailable; start the local stack first');
  }
  // Fixed repository ports and loopback only: these tests must never write to hosted data.
  if (
    !['http://127.0.0.1:54321', 'http://localhost:54321'].includes(status.API_URL) ||
    !status.ANON_KEY ||
    !status.SERVICE_ROLE_KEY
  ) {
    throw new Error('Expected local Supabase on port 54321 with local test keys');
  }
  return { url: status.API_URL, anon: status.ANON_KEY, service: status.SERVICE_ROLE_KEY };
}

export async function request(
  config,
  path,
  { token, key = config.anon, method = 'GET', body, headers = {} } = {},
) {
  let response;
  try {
    response = await fetch(`${config.url}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        apikey: key,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Local HTTP request failed or timed out');
  }
  let data;
  try {
    const text = await response.text();
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Local HTTP response was not JSON (status ${response.status})`);
  }
  return { status: response.status, data };
}

export function requireStatus(response, expected, label) {
  if (response.status !== expected) {
    // Deliberately omit response bodies: Auth responses can contain credentials.
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}`);
  }
  return response.data;
}
