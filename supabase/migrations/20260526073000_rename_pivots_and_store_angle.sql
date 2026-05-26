alter table public.fields
  add column if not exists pivot_angle_degrees integer;

update public.fields
set pivot_angle_degrees = case lower(coalesce(pivot_alignment, ''))
  when 'north' then 0
  when 'north-east' then 45
  when 'east' then 90
  when 'south-east' then 135
  when 'south' then 180
  when 'south-west' then 225
  when 'west' then 270
  when 'north-west' then 315
  else pivot_angle_degrees
end
where pivot_angle_degrees is null;

update public.fields
set field_type = 'pivot'
where field_type = 'pervits';

update public.fields
set pivot_angle_degrees = 0
where field_type = 'pivot'
  and pivot_angle_degrees is null;

alter table public.fields
  drop constraint if exists fields_field_type_check;

alter table public.fields
  add constraint fields_field_type_check
  check (field_type in ('pivot', 'normal'));

alter table public.fields
  drop constraint if exists fields_pivot_angle_degrees_check;

alter table public.fields
  add constraint fields_pivot_angle_degrees_check
  check (
    pivot_angle_degrees is null
    or (pivot_angle_degrees >= 0 and pivot_angle_degrees < 360)
  );

alter table public.fields
  drop column if exists pivot_alignment;

drop function if exists public.get_fields_for_farmer(uuid);
drop function if exists public.create_field(uuid, text, jsonb, text, text);

create or replace function public.get_fields_for_farmer(
  input_farmer_id uuid
)
returns table (
  id uuid,
  field_name text,
  boundary jsonb,
  field_type text,
  pivot_angle_degrees integer
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
    fields.pivot_angle_degrees
  from public.fields
  where fields.farmer_id = input_farmer_id
  order by fields.field_name asc;
$$;

create or replace function public.create_field(
  input_farmer_id uuid,
  input_field_name text,
  input_boundary jsonb,
  input_field_type text default 'normal',
  input_pivot_angle_degrees integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  inserted_id uuid;
  normalized_field_type text := lower(trim(coalesce(input_field_type, 'normal')));
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

  if normalized_field_type not in ('pivot', 'normal') then
    raise exception 'Field type must be pivot or normal.';
  end if;

  if normalized_field_type = 'pivot' and input_pivot_angle_degrees is null then
    raise exception 'Pivot angle is required for pivot fields.';
  end if;

  if input_pivot_angle_degrees is not null
     and (input_pivot_angle_degrees < 0 or input_pivot_angle_degrees >= 360) then
    raise exception 'Pivot angle must be between 0 and 359 degrees.';
  end if;

  insert into public.fields (farmer_id, field_name, boundary, field_type, pivot_angle_degrees)
  values (
    input_farmer_id,
    trim(input_field_name),
    st_setsrid(st_geomfromgeojson(input_boundary::text), 4326),
    normalized_field_type,
    case
      when normalized_field_type = 'pivot' then input_pivot_angle_degrees
      else null
    end
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;
