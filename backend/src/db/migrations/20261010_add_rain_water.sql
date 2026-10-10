-- Add the default source without changing existing readings or sources.
INSERT INTO water_sources (name, source_type)
SELECT 'Rain Water', 'rainwater'
WHERE NOT EXISTS (
    SELECT 1 FROM water_sources WHERE LOWER(TRIM(name)) = 'rain water'
);
