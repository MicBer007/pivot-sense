alter table public.fields
  add column if not exists field_type text not null default 'normal',
  add column if not exists pivot_alignment text;

alter table public.fields
  drop constraint if exists fields_field_type_check;

alter table public.fields
  add constraint fields_field_type_check
  check (field_type in ('pervits', 'normal'));

alter table public.fields
  drop constraint if exists fields_pivot_alignment_check;

alter table public.fields
  add constraint fields_pivot_alignment_check
  check (
    pivot_alignment is null
    or pivot_alignment in ('north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west')
  );

update public.fields
set
  field_type = case
    when lower(trim(field_name)) like '%pivot%' then 'pervits'
    else 'normal'
  end,
  pivot_alignment = case
    when lower(trim(field_name)) like '%pivot%' then 'north'
    else null
  end
where field_type is null
   or pivot_alignment is null;

drop function if exists public.get_fields_for_farmer(uuid);
drop function if exists public.create_field(uuid, text, jsonb);

create or replace function public.get_fields_for_farmer(
  input_farmer_id uuid
)
returns table (
  id uuid,
  field_name text,
  boundary jsonb,
  field_type text,
  pivot_alignment text
)
language sql
security invoker
set search_path = public
as $$
  select
    fields.id,
    fields.field_name,
    st_asgeojson(fields.boundary)::jsonb as boundary,
    fields.field_type,
    fields.pivot_alignment
  from public.fields
  where fields.farmer_id = input_farmer_id
  order by fields.field_name asc;
$$;

create or replace function public.create_field(
  input_farmer_id uuid,
  input_field_name text,
  input_boundary jsonb,
  input_field_type text default 'normal',
  input_pivot_alignment text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  inserted_id uuid;
  normalized_field_type text := lower(trim(coalesce(input_field_type, 'normal')));
  normalized_pivot_alignment text := lower(trim(coalesce(input_pivot_alignment, '')));
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

  if normalized_field_type not in ('pervits', 'normal') then
    raise exception 'Field type must be pervits or normal.';
  end if;

  if normalized_field_type = 'pervits' and normalized_pivot_alignment = '' then
    raise exception 'Pivot alignment is required for pervits fields.';
  end if;

  if normalized_field_type = 'normal' then
    normalized_pivot_alignment := '';
  end if;

  if normalized_pivot_alignment <> ''
     and normalized_pivot_alignment not in (
       'north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'
     ) then
    raise exception 'Pivot alignment is invalid.';
  end if;

  insert into public.fields (farmer_id, field_name, boundary, field_type, pivot_alignment)
  values (
    input_farmer_id,
    trim(input_field_name),
    st_setsrid(st_geomfromgeojson(input_boundary::text), 4326),
    normalized_field_type,
    nullif(normalized_pivot_alignment, '')
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;
