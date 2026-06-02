create or replace function public.get_water_per_day_for_farmer(
  input_farmer_id uuid,
  input_days integer default 7
)
returns table (
  day date,
  field_id uuid,
  field_name text,
  total_mm numeric,
  total_liters numeric
)
language sql
stable
as $$
  select
    actions.end_date as day,
    fields.id as field_id,
    fields.field_name,
    sum(actions.mm_applied_at_pivot * (actions.movement_degrees / 360.0)) as total_mm,
    sum(
      actions.mm_applied_at_pivot
      * (actions.movement_degrees / 360.0)
      * st_area(fields.boundary::geography)
    ) as total_liters
  from public.actions
  join public.fields on fields.id = actions.field_id
  where fields.farmer_id = input_farmer_id
    and actions.end_date >= current_date - (greatest(input_days, 1) - 1)
  group by actions.end_date, fields.id, fields.field_name
  order by actions.end_date asc, fields.field_name asc;
$$;
