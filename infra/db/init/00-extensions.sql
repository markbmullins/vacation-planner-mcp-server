-- 00-extensions.sql
-- Runs automatically when the Postgres container is first created.
-- Enables pgvector so that vector columns and similarity search work
-- without any extra steps from the application or migration scripts.

CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
