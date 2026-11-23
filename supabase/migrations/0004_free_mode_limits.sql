-- Free mode: no paid tier yet. Generous limits; one concurrent job because the worker is a single small host.
update public.plan_limits set
  max_active_projects = 20,
  max_processing_minutes_month = 600,
  max_clips_month = 300,
  max_storage_bytes = 3221225472,
  max_oyinca_connections = 5,
  max_concurrent_jobs = 1
where plan = 'free';
