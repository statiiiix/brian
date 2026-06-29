-- Tests connect with search_path=test,public (set via TEST_DATABASE_URL options),
-- so all test tables live in the `test` schema and truncation never touches live
-- `public` data. Harmless no-op for the live/public connection.
create schema if not exists test;
