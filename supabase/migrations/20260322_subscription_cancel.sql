-- Add subscription tracking fields for cancellation support
alter table public.orders
    add column if not exists stripe_subscription_id text,
    add column if not exists subscription_status text not null default 'active';
