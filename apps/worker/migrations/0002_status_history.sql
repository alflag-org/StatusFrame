ALTER TABLE public_snapshot ADD COLUMN history_json TEXT CHECK(history_json IS NULL OR json_valid(history_json));
