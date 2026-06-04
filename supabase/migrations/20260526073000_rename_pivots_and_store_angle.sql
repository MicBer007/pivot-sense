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
