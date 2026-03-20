-- Shared product catalog so admin changes propagate to all users
create table if not exists public.product_catalog (
    id text primary key,
    data jsonb not null,
    updated_at timestamptz not null default now()
);

alter table public.product_catalog enable row level security;

-- Everyone can read the catalog
create policy "anyone can read catalog"
on public.product_catalog
for select
to anon, authenticated
using (true);

-- Only authenticated users can insert/update/delete (admin check is in app logic)
create policy "authenticated can insert catalog"
on public.product_catalog
for insert
to authenticated
with check (true);

create policy "authenticated can update catalog"
on public.product_catalog
for update
to authenticated
using (true);

create policy "authenticated can delete catalog"
on public.product_catalog
for delete
to authenticated
using (true);
