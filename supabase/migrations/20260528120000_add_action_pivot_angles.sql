alter table public.actions
  add column if not exists start_pivot_angle_degrees integer not null default 0,
  add column if not exists sweep_direction smallint not null default 1;

alter table public.actions
  drop constraint if exists actions_start_angle_check;
alter table public.actions
  add constraint actions_start_angle_check
  check (start_pivot_angle_degrees >= 0 and start_pivot_angle_degrees < 360);

alter table public.actions
  drop constraint if exists actions_sweep_direction_check;
alter table public.actions
  add constraint actions_sweep_direction_check
  check (sweep_direction in (-1, 1));

-- Replace the 6-argument log_action with a version that also records the
-- pivot start angle and sweep direction so a logged action can be redrawn later.
drop function if exists public.log_action(uuid, uuid, date, integer, numeric, integer);

create or replace function public.log_action(
  input_farmer_id uuid,
  input_field_id uuid,
  input_end_date date,
  input_movement_degrees integer,
  input_mm_applied_at_pivot numeric,
  input_new_pivot_angle_degrees integer,
  input_start_pivot_angle_degrees integer,
  input_sweep_direction integer
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

  if input_start_pivot_angle_degrees is null
     or input_start_pivot_angle_degrees < 0
     or input_start_pivot_angle_degrees >= 360 then
    raise exception 'Start pivot angle must be between 0 and 359 degrees.';
  end if;

  if input_sweep_direction is null or input_sweep_direction not in (-1, 1) then
    raise exception 'Sweep direction must be -1 or 1.';
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
    mm_applied_at_pivot,
    start_pivot_angle_degrees,
    sweep_direction
  )
  values (
    input_field_id,
    input_end_date,
    input_movement_degrees,
    input_mm_applied_at_pivot,
    input_start_pivot_angle_degrees,
    input_sweep_direction
  )
  returning id into inserted_id;

  update public.fields
  set pivot_angle_degrees = input_new_pivot_angle_degrees
  where id = input_field_id
    and farmer_id = input_farmer_id;

  return inserted_id;
end;
$$;
