create table if not exists public.farmers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists farmers_normalized_name_idx on public.farmers (normalized_name);

alter table public.fields add column if not exists farmer_id uuid references public.farmers (id) on delete cascade;
alter table public.fields alter column farmer_id drop not null;
alter table public.fields alter column user_id drop default;

drop function if exists public.get_my_fields();
drop function if exists public.create_field(text, jsonb);

alter table public.fields disable row level security;

drop policy if exists "Users can view their own fields" on public.fields;
drop policy if exists "Users can insert their own fields" on public.fields;
drop policy if exists "Users can update their own fields" on public.fields;
drop policy if exists "Users can delete their own fields" on public.fields;

alter table public.fields drop column if exists user_id;
alter table public.fields alter column farmer_id set not null;

drop index if exists fields_user_id_idx;
create index if not exists fields_farmer_id_idx on public.fields (farmer_id);
