-- Add DELETE policies for orders and order_items
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'orders'
          AND policyname = 'anon can delete orders'
    ) THEN
        CREATE POLICY "anon can delete orders"
        ON public.orders
        FOR DELETE
        TO anon
        USING (true);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'order_items'
          AND policyname = 'anon can delete order items'
    ) THEN
        CREATE POLICY "anon can delete order items"
        ON public.order_items
        FOR DELETE
        TO anon
        USING (true);
    END IF;
END
$$;
