DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'orders'
          AND policyname = 'authenticated can delete orders'
    ) THEN
        CREATE POLICY "authenticated can delete orders"
        ON public.orders
        FOR DELETE
        TO authenticated
        USING (true);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'order_items'
          AND policyname = 'authenticated can delete order items'
    ) THEN
        CREATE POLICY "authenticated can delete order items"
        ON public.order_items
        FOR DELETE
        TO authenticated
        USING (true);
    END IF;
END
$$;
