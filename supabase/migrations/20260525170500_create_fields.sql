create extension if not exists postgis;

create table if not exists public.fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  field_name text not null,
  boundary geometry(Polygon, 4326) not null
);

alter table public.fields enable row level security;

create policy "Users can view their own fields"
on public.fields
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own fields"
on public.fields
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own fields"
on public.fields
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own fields"
on public.fields
for delete
to authenticated
using (auth.uid() = user_id);

create index if not exists fields_user_id_idx on public.fields (user_id);
create index if not exists fields_boundary_gix on public.fields using gist (boundary);
