create or replace function public.update_field(
  input_farmer_id uuid,
  input_field_id uuid,
  input_field_name text,
  input_pivot_angle_degrees integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  existing_field_type text;
begin
  if input_farmer_id is null then
    raise exception 'Farmer is required.';
  end if;

  if input_field_id is null then
    raise exception 'Field is required.';
  end if;

  if coalesce(trim(input_field_name), '') = '' then
    raise exception 'Field name is required.';
  end if;

  select fields.field_type
  into existing_field_type
  from public.fields
  where fields.id = input_field_id
    and fields.farmer_id = input_farmer_id
  limit 1;

  if existing_field_type is null then
    raise exception 'Field not found.';
  end if;

  if existing_field_type = 'pivot' and input_pivot_angle_degrees is null then
    raise exception 'Pivot angle is required for pivot fields.';
  end if;

  if input_pivot_angle_degrees is not null
     and (input_pivot_angle_degrees < 0 or input_pivot_angle_degrees >= 360) then
    raise exception 'Pivot angle must be between 0 and 359 degrees.';
  end if;

  update public.fields
  set
    field_name = trim(input_field_name),
    pivot_angle_degrees = case
      when existing_field_type = 'pivot' then input_pivot_angle_degrees
      else null
    end
  where id = input_field_id
    and farmer_id = input_farmer_id;

  return input_field_id;
end;
$$;

create or replace function public.delete_field(
  input_farmer_id uuid,
  input_field_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  deleted_id uuid;
begin
  if input_farmer_id is null then
    raise exception 'Farmer is required.';
  end if;

  if input_field_id is null then
    raise exception 'Field is required.';
  end if;

  delete from public.fields
  where id = input_field_id
    and farmer_id = input_farmer_id
  returning id into deleted_id;

  if deleted_id is null then
    raise exception 'Field not found.';
  end if;

  return deleted_id;
end;
$$;
