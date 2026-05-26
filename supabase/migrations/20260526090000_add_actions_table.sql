create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.fields (id) on delete cascade,
  end_date date not null,
  movement_degrees integer not null,
  mm_applied_at_pivot numeric(10, 2) not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint actions_movement_degrees_check check (movement_degrees >= 0 and movement_degrees <= 360),
  constraint actions_mm_applied_check check (mm_applied_at_pivot >= 0)
);

create index if not exists actions_field_id_idx on public.actions (field_id);
create index if not exists actions_field_end_date_idx on public.actions (field_id, end_date desc);

create or replace function public.log_action(
  input_farmer_id uuid,
  input_field_id uuid,
  input_end_date date,
  input_movement_degrees integer,
  input_mm_applied_at_pivot numeric,
  input_new_pivot_angle_degrees integer
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  existing_field_type text;
  inserted_id uuid;
begin
  if input_farmer_id is null then
    raise exception 'Farmer is required.';
  end if;

  if input_field_id is null then
    raise exception 'Field is required.';
  end if;

  if input_end_date is null then
    raise exception 'End date is required.';
  end if;

  if input_movement_degrees is null or input_movement_degrees < 0 or input_movement_degrees > 360 then
    raise exception 'Movement must be between 0 and 360 degrees.';
  end if;

  if input_mm_applied_at_pivot is null or input_mm_applied_at_pivot < 0 then
    raise exception 'Millimetres applied must be zero or greater.';
  end if;

  if input_new_pivot_angle_degrees is null
     or input_new_pivot_angle_degrees < 0
     or input_new_pivot_angle_degrees >= 360 then
    raise exception 'New pivot angle must be between 0 and 359 degrees.';
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

  if existing_field_type <> 'pivot' then
    raise exception 'Actions can only be logged on pivot fields.';
  end if;

  insert into public.actions (
    field_id,
    end_date,
    movement_degrees,
    mm_applied_at_pivot
  )
  values (
    input_field_id,
    input_end_date,
    input_movement_degrees,
    input_mm_applied_at_pivot
  )
  returning id into inserted_id;

  update public.fields
  set pivot_angle_degrees = input_new_pivot_angle_degrees
  where id = input_field_id
    and farmer_id = input_farmer_id;

  return inserted_id;
end;
$$;
