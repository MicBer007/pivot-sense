alter table public.actions
  add column if not exists action_type text not null default 'irrigation';

alter table public.actions
  drop constraint if exists actions_action_type_check;
alter table public.actions
  add constraint actions_action_type_check
  check (action_type in ('irrigation', 'rain'));

create index if not exists actions_field_action_type_idx
  on public.actions (field_id, action_type);
