SELECT policyname, tablename, cmd FROM pg_policies WHERE schemaname = 'public' AND (tablename = 'orders' OR tablename = 'order_items');
