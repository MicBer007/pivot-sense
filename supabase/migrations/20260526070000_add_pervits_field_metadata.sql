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
