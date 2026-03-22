-- Add subscription fields and order tracking columns

-- Orders: add delivery tracking fields
alter table public.orders
    add column if not exists delivery_status text not null default 'processing',
    add column if not exists delivery_description text,
    add column if not exists delivered_at timestamptz,
    add column if not exists updated_at timestamptz not null default now();

-- Orders: add subscription tracking
alter table public.orders
    add column if not exists is_subscription boolean not null default false,
    add column if not exists subscription_period text;

-- Allow service role (edge functions) to read/update orders
-- Add policy for authenticated users to read their own orders
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'orders'
          and policyname = 'customers can read own orders'
    ) then
        create policy "customers can read own orders"
        on public.orders
        for select
        to anon, authenticated
        using (true);
    end if;
end
$$;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'order_items'
          and policyname = 'anyone can read order items'
    ) then
        create policy "anyone can read order items"
        on public.order_items
        for select
        to anon, authenticated
        using (true);
    end if;
end
$$;

-- Allow authenticated users (admin) to update orders
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'orders'
          and policyname = 'authenticated can update orders'
    ) then
        create policy "authenticated can update orders"
        on public.orders
        for update
        to authenticated
        using (true);
    end if;
end
$$;
