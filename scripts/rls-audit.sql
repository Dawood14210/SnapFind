-- SQL Editor: verifies all application tables exist and have RLS enabled.
do $$ declare v_table text; begin
  foreach v_table in array array['rooms','players','events','locations','reveals','snapshots','tasks','ability_uses','tags','sos_alerts'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_table and c.relrowsecurity) then
      raise exception 'FAIL: RLS missing/disabled for %', v_table;
    end if;
    raise notice 'PASS: RLS enabled for %', v_table;
  end loop;
end $$;
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' or (schemaname='storage' and tablename='objects') order by schemaname,tablename,policyname;
-- Expected false, false, true:
select has_function_privilege('anon','public.record_sos(uuid,uuid,double precision,double precision)','execute') as anon_execute,
  has_function_privilege('authenticated','public.record_sos(uuid,uuid,double precision,double precision)','execute') as authenticated_execute,
  has_function_privilege('service_role','public.record_sos(uuid,uuid,double precision,double precision)','execute') as service_execute;
