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

create or replace function public.upsert_farmer(
  input_name text
)
returns table (
  id uuid,
  name text,
  was_created boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  trimmed_name text := trim(coalesce(input_name, ''));
  normalized_name_value text;
  farmer_row public.farmers%rowtype;
begin
  if trimmed_name = '' then
    raise exception 'Name is required.';
  end if;

  normalized_name_value := regexp_replace(lower(trimmed_name), '[^a-z0-9]+', '.', 'g');
  normalized_name_value := regexp_replace(normalized_name_value, '(^\.+|\.+$)', '', 'g');
  normalized_name_value := regexp_replace(normalized_name_value, '\.{2,}', '.', 'g');

  if normalized_name_value = '' then
    normalized_name_value := 'farmer';
  end if;

  select *
  into farmer_row
  from public.farmers
  where normalized_name = normalized_name_value
  limit 1;

  if found then
    return query
    select
      farmer_row.id,
      farmer_row.name,
      false;
    return;
  end if;

  insert into public.farmers (
    name,
    normalized_name
  )
  values (
    trimmed_name,
    normalized_name_value
  )
  returning *
  into farmer_row;

  return query
  select
    farmer_row.id,
    farmer_row.name,
    true;
end;
$$;

create or replace function public.get_farmer(
  input_farmer_id uuid
)
returns table (
  id uuid,
  name text
)
language sql
security invoker
set search_path = public
as $$
  select
    farmers.id,
    farmers.name
  from public.farmers
  where farmers.id = input_farmer_id
  limit 1;
$$;

create or replace function public.get_fields_for_farmer(
  input_farmer_id uuid
)
returns table (
  id uuid,
  field_name text,
  boundary jsonb
)
language sql
security invoker
set search_path = public
as $$
  select
    fields.id,
    fields.field_name,
    st_asgeojson(fields.boundary)::jsonb as boundary
  from public.fields
  where fields.farmer_id = input_farmer_id
  order by fields.field_name asc;
$$;

create or replace function public.create_field(
  input_farmer_id uuid,
  input_field_name text,
  input_boundary jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  inserted_id uuid;
begin
  if input_farmer_id is null then
    raise exception 'Farmer is required.';
  end if;

  if not exists (
    select 1
    from public.farmers
    where farmers.id = input_farmer_id
  ) then
    raise exception 'Farmer not found.';
  end if;

  if coalesce(trim(input_field_name), '') = '' then
    raise exception 'Field name is required.';
  end if;

  if input_boundary is null then
    raise exception 'Field boundary is required.';
  end if;

  insert into public.fields (farmer_id, field_name, boundary)
  values (
    input_farmer_id,
    trim(input_field_name),
    st_setsrid(st_geomfromgeojson(input_boundary::text), 4326)
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;
