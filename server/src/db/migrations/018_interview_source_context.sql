-- Source-grounded interviews: a bounded snapshot of the connector content the
-- interview was created from (provider, documents with title/url/text, and
-- fetch time). Null for ordinary expert interviews. Snapshotting keeps the
-- interview reproducible even if the source pages change mid-conversation.
alter table interviews add column if not exists source_context jsonb;
