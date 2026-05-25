create or replace function public.get_my_fields()
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
  where fields.user_id = auth.uid()
  order by fields.field_name asc;
$$;

create or replace function public.create_field(
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
  if coalesce(trim(input_field_name), '') = '' then
    raise exception 'Field name is required.';
  end if;

  if input_boundary is null then
    raise exception 'Field boundary is required.';
  end if;

  insert into public.fields (field_name, boundary)
  values (
    trim(input_field_name),
    st_setsrid(st_geomfromgeojson(input_boundary::text), 4326)
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;
