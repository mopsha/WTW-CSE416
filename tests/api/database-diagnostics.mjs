// Database-only failure diagnostics. Never log response bodies or request headers.
const identifiers = new Set([
  'public',
  'picks',
  'pick_candidates',
  'pick_participants',
  'my_pick_summaries',
  'picks_winner_is_candidate',
  'id',
  'pick_id',
  'place_id',
  'winner_place_id',
  'snapshot',
  'name',
  'p_history',
  'p_limit',
  'p_before_time',
  'p_before_id',
]);
export function sanitizeDatabaseText(value) {
  if (typeof value !== 'string') return null;
  if (value.length > 16384) return '[oversized diagnostic withheld]';
  if (
    /\b(?:authorization|bearer|apikey|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|jwt[_-]?secret|client[_-]?secret|secret[_-]?key)\b/i.test(
      value,
    )
  )
    return '[sensitive diagnostic withheld]';
  if (
    /failing row contains|request\.jwt|request\.headers|\bset_config\s*\(|^\s*(?:STATEMENT|CONTEXT|SQL statement):/i.test(
      value,
    )
  )
    return '[SQL or row values withheld]';
  return value
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token redacted]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, '[key redacted]')
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi, '[URL redacted]')
    .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email redacted]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id redacted]')
    .replace(/'(?:''|[^'])*'|"(?:\\"|[^"])*"/g, (text) =>
      identifiers.has(text.slice(1, -1)) ? text : "'[literal redacted]'",
    )
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .slice(0, 800);
}
function detailsOf(value) {
  if (typeof value === 'string') return sanitizeDatabaseText(value);
  if (value == null) return null;
  // PGRST201 describes relationships as a bounded array. Ignore arbitrary fields.
  if (Array.isArray(value))
    return value
      .slice(0, 5)
      .map((item) =>
        Object.fromEntries(
          ['cardinality', 'embedding', 'relationship']
            .filter((key) => typeof item?.[key] === 'string')
            .map((key) => [key, sanitizeDatabaseText(item[key])]),
        ),
      );
  return '[structured details withheld]';
}
export function databaseFailureSummary(data) {
  const code =
    typeof data?.code === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9A-Z]{3})$/.test(data.code)
      ? data.code
      : 'unavailable';
  return JSON.stringify({
    code,
    message: sanitizeDatabaseText(data?.message),
    details: detailsOf(data?.details),
    hint: sanitizeDatabaseText(data?.hint),
  });
}
export function serviceFailureLines(text) {
  const result = [];
  for (const line of text.split('\n')) {
    // Never include SQL statements, parameter dumps, Auth logs or raw access URLs.
    const error = line.match(/\b(ERROR|FATAL|PANIC):\s*(.*)$/);
    if (error) {
      result.push(error[1] + ': ' + sanitizeDatabaseText(error[2]));
      continue;
    }
    const access = line.match(
      /"POST \/rpc\/my_pick_summaries(?:\?[^ ]*)? HTTP\/[^"]+" ([45]\d{2})\b/,
    );
    if (access) result.push('POST /rpc/my_pick_summaries HTTP ' + access[1]);
    // PostgREST logs some failures as JSON; project only the database error fields.
    const start = line.indexOf('{');
    if (start >= 0) {
      try {
        const data = JSON.parse(line.slice(start));
        if (/^(?:[0-9A-Z]{5}|PGRST[0-9A-Z]{3})$/.test(data?.code ?? ''))
          result.push(databaseFailureSummary(data));
      } catch {
        /* Non-JSON/context lines are deliberately omitted. */
      }
    }
  }
  return [...new Set(result)].slice(-30);
}
