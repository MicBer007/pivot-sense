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
