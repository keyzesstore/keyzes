-- Enable full replica identity so Realtime sends old+new row on UPDATE
ALTER TABLE orders REPLICA IDENTITY FULL;
