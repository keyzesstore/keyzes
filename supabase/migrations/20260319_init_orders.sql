create extension if not exists pgcrypto;

create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    customer_email text not null,
    status text not null default 'pending',
    subtotal numeric(12,2) not null check (subtotal >= 0),
    currency text not null default 'USD',
    source text not null default 'web',
    created_at timestamptz not null default now()
);

create table if not exists public.order_items (
    id bigint generated always as identity primary key,
    order_id uuid not null references public.orders(id) on delete cascade,
    product_id text not null,
    product_title text not null,
    variant_name text,
    unit_price numeric(12,2) not null check (unit_price >= 0),
    qty integer not null check (qty > 0),
    line_total numeric(12,2) not null check (line_total >= 0),
    created_at timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Public checkout inserts only (no public reads)
do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'orders'
          and policyname = 'public can insert orders'
    ) then
        create policy "public can insert orders"
        on public.orders
        for insert
        to anon
        with check (true);
    end if;
end
$$;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'order_items'
          and policyname = 'public can insert order items'
    ) then
        create policy "public can insert order items"
        on public.order_items
        for insert
        to anon
        with check (true);
    end if;
end
$$;
