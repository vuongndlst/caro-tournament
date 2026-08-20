-- Authenticate the timeout worker with a dedicated random secret. The service
-- role JWT remains only as the gateway credential and is never used as the
-- application-level authorization decision.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lsts-expired-match-worker') then
    perform cron.unschedule('lsts-expired-match-worker');
  end if;
end $$;

select cron.schedule(
  'lsts-expired-match-worker',
  '* * * * *',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'lsts_project_url' limit 1)
        || '/functions/v1/game-api',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'lsts_service_role_key' limit 1),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lsts_service_role_key' limit 1),
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lsts_cron_secret' limit 1)
      ),
      body := '{"action":"process_expired_matches"}'::jsonb,
      timeout_milliseconds := 10000
    );
  $cron$
);
