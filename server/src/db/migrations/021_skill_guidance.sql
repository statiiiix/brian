-- Durable source-grounded guidance produced by adaptive interviews.
alter table skills add column if not exists principles jsonb not null default '[]'::jsonb;
alter table skills add column if not exists quality_checks jsonb not null default '[]'::jsonb;
alter table skills add column if not exists sources jsonb not null default '[]'::jsonb;
