-- Preserve the capacity used for each month's tanker readings.  This keeps
-- historical consumption unchanged when the default tanker capacity changes.
ALTER TABLE water_source_readings
  ADD COLUMN IF NOT EXISTS capacity_litres NUMERIC;
