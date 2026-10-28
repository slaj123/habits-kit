-- Daily to-do list. An open task rolls over every day until checked off;
-- its age (today − created_day) drives how urgent it looks. A checked task
-- shows for the rest of its done_day, then drops off the list.
-- Days use the same 4 a.m. cutoff as Daily Log and vices.
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_day TEXT NOT NULL,
  done_at TEXT,
  done_day TEXT
);
CREATE INDEX IF NOT EXISTS todos_open ON todos (done_at);
