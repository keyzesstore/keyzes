-- Add stripe_subscription_id column for cancellation support
alter table public.orders
    add column if not exists stripe_subscription_id text;
