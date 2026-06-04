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

drop function if exists public.log_action(uuid, uuid, date, integer, numeric, integer);
drop function if exists public.log_action(uuid, uuid, date, integer, numeric, integer, integer, integer);
