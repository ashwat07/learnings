-- Drill 13 — reference.

-- 1. FULL TEXT. GIN over the tsvector expression.
--    The 'english' argument is not optional: to_tsvector(body) with one argument uses
--    default_text_search_config, which is a SESSION SETTING, which makes the expression
--    non-IMMUTABLE, which means Postgres will not let you index it at all. Two arguments, always.
CREATE INDEX idx_articles_fts ON drill_articles
  USING gin (to_tsvector('english', body));

-- 2. FUZZY. GIN over trigrams.
CREATE INDEX idx_articles_title_trgm ON drill_articles
  USING gin (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- THE THINGS THAT DECIDE WHETHER THIS WORKS IN PRODUCTION
--
-- STORE THE VECTOR, DO NOT COMPUTE IT
-- An expression index recomputes to_tsvector for every row it indexes, and the planner has no
-- statistics about the result. On a table you search constantly, use a generated column:
--
--     ALTER TABLE drill_articles ADD COLUMN search tsvector
--       GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED;
--     CREATE INDEX ON drill_articles USING gin (search);
--
-- Now the query is `WHERE search @@ ...`, which is simpler to write, gives the planner real
-- statistics, and — because you concatenated the columns — searches the title and the body at
-- once. Weight them if the title should count for more:
--
--     setweight(to_tsvector('english', title), 'A') ||
--     setweight(to_tsvector('english', body),  'B')
--
-- ...and ts_rank then respects those weights.
--
-- GIN VERSUS GiST, for text
--   GIN   ~3x faster to search, ~3x slower to build and update, larger. Use it. This is the
--         default advice for a corpus that is read far more than written, which is all of them.
--   GiST  lossy (every hit needs a heap recheck), cheaper to update, and the only option for some
--         operators. Reach for it when writes dominate.
--
-- TRIGRAM: THE TWO OPERATOR CLASSES
--   gin_trgm_ops     supports LIKE / ILIKE / ~ / ~* and the similarity operator %
--   gist_trgm_ops    also supports ORDER BY title <-> 'query'  — a nearest-neighbour "did you
--                    mean" search, which GIN cannot do
-- Trigram matching needs at least three characters, so `ILIKE '%ab%'` falls back to a scan
-- whatever you index. That is a real limit on an as-you-type search, and the usual fix is to
-- require three characters before you query at all.
--
-- WHAT POSTGRES FULL-TEXT SEARCH DOES NOT DO, HONESTLY
-- It is good enough for most applications and it is not a search engine:
--   · no built-in fuzzy matching in the tsquery (trigram is a separate mechanism you bolt on)
--   · ts_rank is a fairly crude relevance function — no BM25, no learned ranking, no per-field
--     boosting beyond the four weight classes
--   · no faceting, no aggregations over matches, no synonym management worth the name
--   · one language per index. A multilingual corpus needs a column per configuration.
--   · phrase search exists (<-> since 9.6) but proximity ranking does not
--
-- The rule that works: use Postgres FTS until you can NAME the feature you are missing. Migrating
-- to Elasticsearch or OpenSearch buys you those features and costs you a second datastore, a sync
-- pipeline that can lag or break, and a whole new set of consistency questions — see the CDC
-- material in tier 8.5. Most applications never need to make that trade, and the ones that do
-- know exactly why.
