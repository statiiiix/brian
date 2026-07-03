create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  name          text,
  role          text not null default 'admin',
  created_at    timestamptz not null default now()
);
alter table users enable row level security;

create table if not exists interviews (
  id                 uuid primary key default gen_random_uuid(),
  topic              text not null,
  owner              text,
  status             text not null default 'active',
  messages           jsonb not null default '[]',
  coverage           jsonb not null default '{}',
  draft              jsonb,
  resulting_skill_id uuid references skills(id),
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table interviews enable row level security;
