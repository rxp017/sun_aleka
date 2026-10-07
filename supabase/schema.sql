-- Optional cloud calculation copies. Apply once to a new Supabase project.
create table if not exists public.solar_calculations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('travel', 'property', 'photo', 'event')),
  request_payload jsonb not null,
  result_payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.solar_calculations enable row level security;
revoke all on public.solar_calculations from anon;
grant select, insert on public.solar_calculations to authenticated;

create policy "Users can read their own calculations"
  on public.solar_calculations for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can save their own calculations"
  on public.solar_calculations for insert to authenticated
  with check ((select auth.uid()) = user_id);

create index if not exists solar_calculations_user_created_idx
  on public.solar_calculations (user_id, created_at desc);
