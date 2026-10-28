-- Memories can last a while (a house owned 2015–2021) or repeat (every summer at the lake).
-- date_end uses the same precision as date_start. For repeating memories only its year matters.
ALTER TABLE memories ADD COLUMN date_end TEXT;
ALTER TABLE memories ADD COLUMN ongoing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN repeats INTEGER NOT NULL DEFAULT 0;
