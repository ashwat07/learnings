-- The lab dataset: a small commerce domain, deliberately shaped so that every Postgres lab has
-- something real to find. Read the comments — the "mistakes" in here are on purpose.

DROP TABLE IF EXISTS order_items, orders, events, users, products CASCADE;
DROP TYPE IF EXISTS order_status CASCADE;

CREATE TYPE order_status AS ENUM ('pending', 'paid', 'shipped', 'delivered', 'cancelled');

CREATE TABLE users (
  id           bigserial PRIMARY KEY,
  email        text        NOT NULL UNIQUE,
  name         text        NOT NULL,
  country      text        NOT NULL,
  -- A JSONB blob, so the JSONB/GIN lab has something to index.
  prefs        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id           bigserial PRIMARY KEY,
  sku          text        NOT NULL UNIQUE,
  title        text        NOT NULL,
  description  text        NOT NULL,
  category     text        NOT NULL,
  -- Money as an INTEGER of minor units. Never a float; never a double.
  price_cents  integer     NOT NULL CHECK (price_cents >= 0),
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id           bigserial PRIMARY KEY,
  user_id      bigint      NOT NULL REFERENCES users(id),
  status       order_status NOT NULL,
  total_cents  integer     NOT NULL,
  -- No index on created_at yet. Lab 03 adds it and measures the difference.
  created_at   timestamptz NOT NULL,
  -- Deliberately nullable so the partial-index lab has a sparse column to work with.
  shipped_at   timestamptz
);

CREATE TABLE order_items (
  order_id     bigint      NOT NULL REFERENCES orders(id),
  product_id   bigint      NOT NULL REFERENCES products(id),
  quantity     integer     NOT NULL CHECK (quantity > 0),
  price_cents  integer     NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

-- An append-only event log, for the partitioning, window-function and CDC labs.
CREATE TABLE events (
  id           bigserial,
  user_id      bigint      NOT NULL,
  kind         text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL,
  PRIMARY KEY (id, occurred_at)
);

-- Only the primary keys and the unique constraints exist at seed time. EVERY OTHER INDEX IS
-- SOMETHING YOU ADD IN A LAB, so the before/after numbers are real.
