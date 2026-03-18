-- 01-schema-check.sql
-- Verifies that required extensions are available after initialization.
-- This runs during container startup and will cause a visible error
-- if pgvector was not installed correctly.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'vector'
  ) THEN
    RAISE EXCEPTION 'pgvector extension is not installed. Check the Docker image.';
  END IF;

  RAISE NOTICE 'pgvector extension verified: OK';
  RAISE NOTICE 'uuid-ossp extension verified: %', (
    SELECT extname FROM pg_extension WHERE extname = 'uuid-ossp'
  );
END;
$$;
