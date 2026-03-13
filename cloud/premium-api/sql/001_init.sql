create extension if not exists "pgcrypto";

create table if not exists premium_users (
  id uuid primary key default gen_random_uuid(),
  external_subject text unique not null,
  email text not null,
  stripe_customer_id text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists entitlements (
  user_id uuid not null references premium_users(id) on delete cascade,
  tool_key text not null,
  active boolean not null default false,
  quota_limit integer not null default 5,
  quota_used integer not null default 0,
  period_end_iso timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, tool_key)
);
