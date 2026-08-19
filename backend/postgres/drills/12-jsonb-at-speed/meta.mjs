export const title = 'JSONB that is actually searchable';
export const task = `events.payload is JSONB: { "value": 2623, "source": "web", "session": "s730688" }.
Support has a session id and wants that user's events. 400,000 rows, no index that can help, so
Postgres reads the whole table every time.

Index it. There are two GIN operator classes for jsonb and the size limit below rules one of
them out — work out which, and why, before you write the line.`;
export const passIf = 'fewer than 120 buffers, no Seq Scan, and the index is under 25 MB — the default operator class is 27 MB';

export const query = `
  SELECT id, user_id, kind, occurred_at
  FROM events
  WHERE payload @> '{"session":"s730688"}'
  ORDER BY occurred_at DESC
  LIMIT 20`;

export const maxBuffers = 120;
export const noSeqScanOn = 'events';

export async function custom(sql, { rows }) {
  const [row] = await sql`
    SELECT coalesce(sum(pg_relation_size(indexrelid)), 0) AS bytes
    FROM pg_stat_user_indexes
    WHERE relname = 'events' AND NOT indexrelname = 'events_pkey'`;
  const mb = Number(row.bytes) / 1024 / 1024;
  return [
    { check: 'it still returns the right rows', actual: `${rows.length} events`, pass: rows.length > 0 },
    { check: 'the index is under 25 MB', actual: `${mb.toFixed(1)} MB`, pass: mb > 0 && mb < 25 },
  ];
}
