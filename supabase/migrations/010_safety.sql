-- Phase 8: private SOS positions and atomic pause.
create table public.sos_alerts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now()
);
create index sos_alerts_room_created_idx on public.sos_alerts(room_id, created_at desc);
alter table public.sos_alerts enable row level security;
create policy sos_alerts_host_select on public.sos_alerts for select to authenticated
  using (exists (select 1 from public.rooms r where r.id = sos_alerts.room_id and r.host_id = auth.uid()));

create or replace function public.record_sos(p_room_id uuid, p_player_id uuid, p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if not exists (select 1 from public.players where room_id = p_room_id and id = p_player_id) then raise exception 'NOT_IN_ROOM'; end if;
  if v_room.status not in ('hiding','hunting','paused') then raise exception 'ROUND_NOT_ACTIVE'; end if;
  insert into public.sos_alerts(room_id,player_id,lat,lng) values(p_room_id,p_player_id,p_lat,p_lng) returning id into v_id;
  -- Repeated alerts must not restart the pause clock.
  if v_room.status <> 'paused' then
    update public.rooms set status='paused', paused_at=clock_timestamp() where id=p_room_id;
  end if;
  -- Events are member-readable: coordinates must NEVER go here.
  insert into public.events(room_id,type,payload) values(p_room_id,'sos',jsonb_build_object('alert_id',v_id,'player_id',p_player_id));
  return jsonb_build_object('ok',true,'alert_id',v_id,'round_paused',true);
end; $$;
revoke all on function public.record_sos(uuid,uuid,double precision,double precision) from public, anon, authenticated;
grant execute on function public.record_sos(uuid,uuid,double precision,double precision) to service_role;

-- Guard the SQL reset and remove old safety alerts.
create or replace function rematch(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room          rooms;
  v_next_finder   uuid;
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'NOT_HOST';
  end if;
  select * into v_room from rooms where id = p_room_id;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'ended' then
    raise exception 'ROUND_NOT_ENDED';
  end if;

  -- Direct RPC callers must not bypass storage cleanup.
  if exists (select 1 from storage.objects where bucket_id='snapshots'
    and name like p_room_id::text || '/%') then
    raise exception 'PHOTOS_NOT_PURGED';
  end if;

  -- Next finder: top-scoring hider (ties broken by nickname for determinism).
  select id into v_next_finder from players
  where room_id = p_room_id and role = 'hider'
  order by points desc, nickname asc
  limit 1;

  -- Wipe round data.
  delete from sos_alerts where room_id = p_room_id;
  delete from snapshots where room_id = p_room_id;
  delete from tasks where room_id = p_room_id;
  delete from ability_uses where room_id = p_room_id;
  delete from tags where room_id = p_room_id;
  delete from reveals where room_id = p_room_id;
  delete from events where room_id = p_room_id;
  delete from locations where room_id = p_room_id;

  -- Reset players for the next round.
  update players set
    points      = 0,
    ready       = false,
    status      = 'active',
    role        = null,
    suspect     = false,
    skips_used  = 0
  where room_id = p_room_id;

  -- Lobby: keep the play area and room settings, reset the round clock.
  update rooms set
    status           = 'lobby',
    scores_finalized = false,
    finder_id        = null,
    started_at       = null,
    paused_at        = null,
    paused_total_ms  = 0
  where id = p_room_id;

  return jsonb_build_object('ok', true, 'finder_id', v_next_finder);
end;
$$;
