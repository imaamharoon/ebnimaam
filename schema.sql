-- Initial Ebnimaam order table. Apply to your Neon Postgres database before enabling order persistence.
CREATE TABLE IF NOT EXISTS orders (
 id BIGSERIAL PRIMARY KEY,
 reference TEXT UNIQUE NOT NULL,
 customer_email TEXT,
 amount_kobo BIGINT NOT NULL,
 currency TEXT NOT NULL DEFAULT 'NGN',
 status TEXT NOT NULL DEFAULT 'pending',
 items JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
