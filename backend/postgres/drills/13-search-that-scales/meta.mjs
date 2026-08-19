import { explain, buffers } from '../../../lib/db.mjs';

export const title = 'Search: full-text and fuzzy, without Elasticsearch';
export const task = `A help centre with 150,000 articles. Two searches, both currently reading the
whole table:

  1. FULL TEXT   a rare phrase anywhere in the body, ranked by relevance
  2. FUZZY       a substring of a title: how many articles match ILIKE '%zenith qua%'

A B-tree indexes a whole value, so it cannot answer either one — LIKE '%...%' with a leading
wildcard is unindexable by a B-tree, full stop. Postgres has an index type for each.

Build both. The runner drops and rebuilds the table, so take your time.`;
export const passIf = 'both searches use an index, the buffer counts collapse, and the results are identical';

export const query = `
  SELECT id, title,
         ts_rank(to_tsvector('english', body), plainto_tsquery('english', 'nebular calibration')) AS rank
  FROM drill_articles
  WHERE to_tsvector('english', body) @@ plainto_tsquery('english', 'nebular calibration')
  ORDER BY rank DESC
  LIMIT 20`;

// count(*), not LIMIT 20 — a LIMIT lets the primary key index find twenty matches early and hides
// the fact that nothing is indexed. Counting forces every matching row to be found.
const FUZZY = `SELECT count(*)::int AS n FROM drill_articles WHERE title ILIKE '%zenith qua%'`;

export const noSeqScanOn = 'drill_articles';

export async function setup(sql) {
  await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await sql.unsafe(`DROP TABLE IF EXISTS drill_articles`);
  await sql.unsafe(`CREATE TABLE drill_articles (id bigserial PRIMARY KEY, title text NOT NULL, body text NOT NULL)`);
  // Deterministic prose: a fixed vocabulary, seeded by the row number, so the result counts are
  // the same on every machine and every run.
  await sql.unsafe(`
    INSERT INTO drill_articles (title, body)
    SELECT
      -- g, g/8 and g/64 so the three words vary INDEPENDENTLY: 8 x 8 x 4 = 256 combinations.
      -- (g*7)%8 and (g*13)%8 are both functions of g%8, so they would move together and every
      -- title would be one of eight — a nice illustration of why a "random" seed that is really
      -- one counter gives you far less variety than it looks like.
      (ARRAY['zenith','quartz','nimbus','atlas','vector','ember','orbit','lumen'])[1 + g % 8] || ' ' ||
      (ARRAY['quantum','compact','travel','studio','mini','max','lite','pro'])[1 + (g / 8) % 8] || ' ' ||
      (ARRAY['guide','manual','notes','review'])[1 + (g / 64) % 4],
      concat_ws(' ',
        (ARRAY['the device','this unit','our hardware','the module'])[1 + (g * 3) % 4],
        (ARRAY['supports','requires','emits','measures'])[1 + (g * 11) % 4],
        (ARRAY['quantum resonance','thermal drift','optical alignment','magnetic flux'])[1 + (g * 17) % 4],
        'across a range of', (ARRAY['industrial','laboratory','consumer','marine'])[1 + (g * 19) % 4],
        'conditions, with', (g % 90 + 10)::text, 'documented configurations and a',
        (ARRAY['two','three','five'])[1 + g % 3], 'year warranty on all serviceable parts.',
        -- A rare phrase, in 30 of the 150,000 articles. Selectivity is the whole point of an
        -- index: a term matching a quarter of the corpus is one a sequential scan handles fine.
        CASE WHEN g % 5000 = 0 THEN 'Appendix: nebular calibration procedure.' ELSE '' END)
    FROM generate_series(1, 150000) g`);
  await sql.unsafe(`ANALYZE drill_articles`);
}

export async function teardown(sql) { await sql.unsafe(`DROP TABLE IF EXISTS drill_articles`); }

export async function custom(sql, { plan, buffers: b, rows }) {
  const checks = [];

  checks.push({
    check: 'the ranked full-text search finds all 30 matching articles',
    actual: `${rows.length} rows`,
    pass: rows.length === 20,
  });
  checks.push({
    check: 'full text: under 300 buffers',
    actual: b.hit + b.read,
    pass: b.hit + b.read < 300,
  });

  const fuzzy = await explain(FUZZY);
  const fb = buffers(fuzzy.nodes);
  const fuzzySeq = fuzzy.nodes.some((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === 'drill_articles');
  const fuzzyRows = await sql.unsafe(FUZZY);

  checks.push({ check: 'fuzzy: no Seq Scan', actual: fuzzySeq ? 'Seq Scan present' : 'indexed', pass: !fuzzySeq });
  checks.push({ check: 'fuzzy: under 8,000 buffers', actual: fb.hit + fb.read, pass: fb.hit + fb.read < 8000 });
  checks.push({ check: 'fuzzy: the count is unchanged', actual: `${fuzzyRows[0].n} articles`, pass: fuzzyRows[0].n === 2343 });

  const [size] = await sql`
    SELECT coalesce(sum(pg_relation_size(indexrelid)), 0) AS bytes
    FROM pg_stat_user_indexes WHERE relname = 'drill_articles' AND indexrelname <> 'drill_articles_pkey'`;
  checks.push({
    check: 'you built indexes (not just widened the thresholds)',
    actual: `${(Number(size.bytes) / 1024 / 1024).toFixed(1)} MB of index`,
    pass: Number(size.bytes) > 0,
  });

  return checks;
}
