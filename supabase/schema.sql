-- =====================================================================
-- 園藝智能助理 — Supabase 資料庫結構
-- 使用方式：Supabase Dashboard → SQL Editor → 貼上整份檔案 → Run
-- 可重複執行（會先移除舊的同名物件）。
-- 所有資料表都啟用 Row Level Security：使用者只能存取自己的資料。
-- ESP32 不登入，而是用各自的「裝置權杖」呼叫 device_sync() 上傳數據並取得該裝置的門檻值。
-- =====================================================================

-- ---------- 使用者資料 ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 30),
  address      text not null default '' check (char_length(address) <= 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 註冊時自動建立 profile（姓名、地址來自註冊表單的 metadata）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, address)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 30),
    left(coalesce(new.raw_user_meta_data ->> 'address', ''), 100)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 種植專案 ----------
create table if not exists public.plants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plant_name text not null check (char_length(plant_name) between 1 and 40),
  summary    text not null default '' check (char_length(summary) <= 500),
  start_date date not null default current_date,
  total_days integer not null check (total_days between 1 and 365),
  created_at timestamptz not null default now()
);
create index if not exists plants_user_idx on public.plants (user_id, start_date desc);

-- 生長階段（與前端 growth.js 的 stageFor 規則一致）：
--   planting 種植期（1~7 天）、growing 成長期（~33%）、flowering 開花期（~66%）、fruiting 結果期（~100%）、harvest 收成期
create or replace function public.growth_stage(day integer, total integer)
returns text
language sql
immutable
as $$
  select case
    when day <= 7 then 'planting'
    when day <= total * 0.33 then 'growing'
    when day <= total * 0.66 then 'flowering'
    when day <= total then 'fruiting'
    else 'harvest'
  end
$$;

-- 每個生長階段的自動控制門檻，例如
--   {"planting": {"tempMin": 18, "tempMax": 28, "humidMin": 60, "humidMax": 85, "soilMin": 50}, ...}
-- 寫入前檢查格式與範圍，device_sync() 讀取時就能安全轉型
create or replace function public.valid_stage_thresholds(j jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  k text;
  v jsonb;
begin
  if j is null then
    return true;
  end if;
  if jsonb_typeof(j) <> 'object' then
    return false;
  end if;
  for k, v in select * from jsonb_each(j) loop
    if k not in ('planting', 'growing', 'flowering', 'fruiting', 'harvest') or jsonb_typeof(v) <> 'object' then
      return false;
    end if;
    if not (v ? 'tempMin' and v ? 'tempMax' and v ? 'humidMin' and v ? 'humidMax' and v ? 'soilMin') then
      return false;
    end if;
    if exists (select 1 from jsonb_each(v) e where jsonb_typeof(e.value) <> 'number') then
      return false;
    end if;
    if (v ->> 'tempMin')::real >= (v ->> 'tempMax')::real
       or (v ->> 'tempMin')::real < -10 or (v ->> 'tempMax')::real > 50
       or (v ->> 'humidMin')::real >= (v ->> 'humidMax')::real
       or (v ->> 'humidMin')::real < 0 or (v ->> 'humidMax')::real > 100
       or (v ->> 'soilMin')::real < 0 or (v ->> 'soilMin')::real > 100 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

alter table public.plants add column if not exists stage_thresholds jsonb;
alter table public.plants drop constraint if exists plants_stage_thresholds_valid;
alter table public.plants add constraint plants_stage_thresholds_valid
  check (public.valid_stage_thresholds(stage_thresholds));

-- ---------- AI 照護指南快取（同一天不重複呼叫 AI） ----------
create table if not exists public.plant_guides (
  plant_id   uuid not null references public.plants (id) on delete cascade,
  cache_key  text not null check (char_length(cache_key) <= 40),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  primary key (plant_id, cache_key)
);

-- ---------- AI 使用紀錄（Edge Function 用來限制每人每小時的呼叫次數） ----------
create table if not exists public.ai_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task       text not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_requests_user_idx on public.ai_requests (user_id, created_at desc);

-- ---------- ESP32 自動控制門檻值 ----------
create table if not exists public.thresholds (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  temp_min   real not null default 20,
  temp_max   real not null default 30,
  humid_min  real not null default 40,
  humid_max  real not null default 80,
  soil_min   real not null default 35,
  updated_at timestamptz not null default now(),
  check (temp_min < temp_max and temp_min >= -10 and temp_max <= 50),
  check (humid_min < humid_max and humid_min >= 0 and humid_max <= 100),
  check (soil_min between 0 and 100)
);

-- ---------- 裝置（每塊 ESP32 一組權杖，可各自指定由哪一株植物的生長計畫控制） ----------
--   plant_id 為 null → 使用上面的手動門檻；指定植物 → 依該植物目前的生長階段套用 plants.stage_thresholds
create table if not exists public.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null default 'ESP32' check (char_length(name) between 1 and 30),
  token        uuid not null unique default gen_random_uuid(),
  plant_id     uuid references public.plants (id) on delete set null,
  last_seen_at timestamptz,
  status       jsonb,          -- 裝置最近一次回報的狀態：繼電器、Wi-Fi 訊號、運作時間等
  created_at   timestamptz not null default now()
);

-- 舊版升級：原本每位使用者只有一組權杖（以 user_id 為主鍵），控制模式存在 thresholds。
-- 保留原權杖（已燒進 ESP32 的 config.py 不用改），並把「依生長計畫」的設定搬到該裝置上。
alter table public.devices add column if not exists id uuid not null default gen_random_uuid();
alter table public.devices add column if not exists name text not null default 'ESP32';
alter table public.devices add column if not exists plant_id uuid references public.plants (id) on delete set null;
alter table public.devices add column if not exists last_seen_at timestamptz;
alter table public.devices add column if not exists status jsonb;
alter table public.devices alter column user_id set default auth.uid();
alter table public.devices alter column user_id set not null;
do $$
begin
  if exists (
    select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.devices'::regclass and c.contype = 'p' and a.attname = 'user_id'
  ) then
    alter table public.devices drop constraint devices_pkey;
    alter table public.devices add primary key (id);
    alter table public.devices add constraint devices_name_check check (char_length(name) between 1 and 30);
    update public.devices set name = '溫控節點';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'thresholds' and column_name = 'plant_id') then
    execute $m$
      update public.devices d set plant_id = t.plant_id
      from public.thresholds t
      where t.user_id = d.user_id and t.mode = 'plan' and d.plant_id is null
    $m$;
    drop policy if exists "own thresholds" on public.thresholds;
    alter table public.thresholds drop column plant_id, drop column mode;
  end if;
end;
$$;
create index if not exists devices_user_idx on public.devices (user_id, created_at);

create or replace function public.limit_devices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.devices where user_id = new.user_id) >= 10 then
    raise exception '每個帳號最多 10 塊裝置' using errcode = '54000';
  end if;
  return new;
end;
$$;
drop trigger if exists limit_devices on public.devices;
create trigger limit_devices
  before insert on public.devices
  for each row execute function public.limit_devices();

-- ---------- 感測數據 ----------
create table if not exists public.sensor_readings (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  recorded_at timestamptz not null default now(),
  soil        real check (soil between 0 and 100),
  temperature real check (temperature between -40 and 80),
  humidity    real check (humidity between 0 and 100)
);
create index if not exists sensor_readings_user_idx on public.sensor_readings (user_id, recorded_at desc);
alter table public.sensor_readings add column if not exists device_id uuid references public.devices (id) on delete set null;
create index if not exists sensor_readings_device_idx on public.sensor_readings (device_id, recorded_at desc);

-- ---------- 控制紀錄（裝置啟動／關閉風扇、加熱、澆水時回報） ----------
create table if not exists public.device_events (
  id         bigint generated always as identity primary key,
  device_id  uuid not null references public.devices (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  message    text not null check (char_length(message) between 1 and 120)
);
create index if not exists device_events_device_idx on public.device_events (device_id, created_at desc);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles        enable row level security;
alter table public.plants          enable row level security;
alter table public.plant_guides    enable row level security;
alter table public.ai_requests     enable row level security;
alter table public.thresholds      enable row level security;
alter table public.devices         enable row level security;
alter table public.sensor_readings enable row level security;
alter table public.device_events   enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "own plants" on public.plants;
create policy "own plants" on public.plants
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own guides" on public.plant_guides;
create policy "own guides" on public.plant_guides
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.plants p where p.id = plant_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "own ai requests" on public.ai_requests;
create policy "own ai requests" on public.ai_requests
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own thresholds" on public.thresholds;
create policy "own thresholds" on public.thresholds
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "read own device" on public.devices;
drop policy if exists "read own devices" on public.devices;
create policy "read own devices" on public.devices
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 新增裝置：只能指定自己的植物（每人最多 10 塊由 limit_devices 觸發器檢查）
drop policy if exists "add own devices" on public.devices;
create policy "add own devices" on public.devices
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (plant_id is null or exists (select 1 from public.plants p where p.id = plant_id and p.user_id = (select auth.uid())))
  );

drop policy if exists "edit own devices" on public.devices;
create policy "edit own devices" on public.devices
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (plant_id is null or exists (select 1 from public.plants p where p.id = plant_id and p.user_id = (select auth.uid())))
  );

drop policy if exists "delete own devices" on public.devices;
create policy "delete own devices" on public.devices
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "read own readings" on public.sensor_readings;
create policy "read own readings" on public.sensor_readings
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "read own events" on public.device_events;
create policy "read own events" on public.device_events
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "delete own readings" on public.sensor_readings;
create policy "delete own readings" on public.sensor_readings
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- 明確授權（新版 Supabase 專案不一定會自動開放 public schema 的資料表）
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.plants, public.plant_guides,
  public.ai_requests, public.thresholds to authenticated;
revoke all on public.devices from authenticated;
-- 權杖由資料庫產生，網站只能改名稱與控制的植物（重新產生權杖請用 regenerate_device_token）
grant select, delete on public.devices to authenticated;
grant insert (name, plant_id), update (name, plant_id) on public.devices to authenticated;
grant select, delete on public.sensor_readings to authenticated;
grant select on public.device_events to authenticated;
revoke all on public.profiles, public.plants, public.plant_guides, public.ai_requests,
  public.thresholds, public.devices, public.sensor_readings, public.device_events from anon;

-- =====================================================================
-- 函式
-- =====================================================================


-- 舊版函式（每人一組權杖、單一控制模式），已由下方的裝置函式取代
drop function if exists public.device_token(boolean);
drop function if exists public.my_effective_thresholds();
drop function if exists public.effective_thresholds(uuid);

-- 重新產生某塊裝置的權杖（權杖外洩時使用，舊權杖立即失效）
create or replace function public.regenerate_device_token(p_device uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result uuid;
begin
  update public.devices set token = gen_random_uuid()
  where id = p_device and user_id = auth.uid()
  returning token into result;
  if result is null then
    raise exception 'device not found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- 計算某塊裝置「此刻」應套用的門檻（內部使用，不開放直接呼叫）：
--   裝置指定的植物有該階段門檻 → 用生長計畫的門檻；否則用手動門檻；都沒有則用預設值
create or replace function public.effective_thresholds(uid uuid, p_plant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.thresholds;
  p public.plants;
  day integer;
  stage text;
  s jsonb;
begin
  if p_plant is not null then
    select * into p from public.plants where id = p_plant and user_id = uid;
    if found then
      -- 以台灣日期計算第幾天，與網站顯示一致
      day := (now() at time zone 'Asia/Taipei')::date - p.start_date + 1;
      stage := public.growth_stage(day, p.total_days);
      s := p.stage_thresholds -> stage;
      if s is not null then
        return jsonb_build_object(
          'tempMin',  (s ->> 'tempMin')::real,
          'tempMax',  (s ->> 'tempMax')::real,
          'humidMin', (s ->> 'humidMin')::real,
          'humidMax', (s ->> 'humidMax')::real,
          'soilMin',  (s ->> 'soilMin')::real,
          'source',   'plan',
          'plantId',  p.id,
          'plantName', p.plant_name,
          'day',      day,
          'stage',    stage
        );
      end if;
    end if;
  end if;

  select * into t from public.thresholds where user_id = uid;
  return jsonb_build_object(
    'tempMin',  coalesce(t.temp_min, 20),
    'tempMax',  coalesce(t.temp_max, 30),
    'humidMin', coalesce(t.humid_min, 40),
    'humidMax', coalesce(t.humid_max, 80),
    'soilMin',  coalesce(t.soil_min, 35),
    'source',   case when t.user_id is null then 'default' else 'user' end
  );
end;
$$;

-- 網站顯示「每塊裝置目前套用的門檻」，與 ESP32 拿到的一定相同
create or replace function public.my_device_thresholds()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    public.effective_thresholds(d.user_id, d.plant_id) || jsonb_build_object('deviceId', d.id)
    order by d.created_at), '[]'::jsonb)
  from public.devices d
  where d.user_id = auth.uid()
$$;

-- ESP32 每個週期呼叫一次：上傳數據（可只傳部分欄位）並取得這塊裝置的門檻值
--   p_status：裝置目前狀態，例如 {"node":"climate","relays":{"fan":1,"heater":0},"rssi":-61,"uptime":3600,"ip":"192.168.1.20","mem":82000}
--   p_event ：繼電器狀態改變時的說明，例如「開風扇（25.0°C > 18.0°C）」，記錄在控制紀錄
drop function if exists public.device_sync(uuid, real, real, real);
create or replace function public.device_sync(
  p_token uuid,
  p_soil real default null,
  p_temperature real default null,
  p_humidity real default null,
  p_status jsonb default null,
  p_event text default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.devices;
begin
  select * into d from public.devices where token = p_token;
  if not found then
    raise exception 'invalid device token' using errcode = '28000';
  end if;

  update public.devices
  set last_seen_at = now(),
      -- 只接受物件且限制大小，避免裝置程式錯誤塞爆資料庫
      status = case when jsonb_typeof(p_status) = 'object' and length(p_status::text) <= 1000
                    then p_status else status end
  where id = d.id;

  if coalesce(p_soil, p_temperature, p_humidity) is not null then
    -- 防止裝置程式錯誤狂送資料：每塊裝置每分鐘最多 3 筆（正常是每分鐘 1 筆）
    if (
      select count(*) from public.sensor_readings
      where device_id = d.id and recorded_at > now() - interval '1 minute'
    ) < 3 then
      insert into public.sensor_readings (user_id, device_id, soil, temperature, humidity)
      values (
        d.user_id,
        d.id,
        case when p_soil between 0 and 100 then p_soil end,
        case when p_temperature between -40 and 80 then p_temperature end,
        case when p_humidity between 0 and 100 then p_humidity end
      );
      -- 只保留 90 天，免費方案的空間就夠用
      delete from public.sensor_readings where user_id = d.user_id and recorded_at < now() - interval '90 days';
    end if;
  end if;

  if nullif(btrim(p_event), '') is not null and (
    select count(*) from public.device_events
    where device_id = d.id and created_at > now() - interval '1 minute'
  ) < 10 then
    insert into public.device_events (device_id, user_id, message)
    values (d.id, d.user_id, left(btrim(p_event), 120));
    delete from public.device_events where device_id = d.id and created_at < now() - interval '30 days';
  end if;

  return public.effective_thresholds(d.user_id, d.plant_id)::json;
end;
$$;

revoke all on function public.regenerate_device_token(uuid) from public, anon;
grant execute on function public.regenerate_device_token(uuid) to authenticated;
revoke all on function public.device_sync(uuid, real, real, real, jsonb, text) from public;
grant execute on function public.device_sync(uuid, real, real, real, jsonb, text) to anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.limit_devices() from public, anon, authenticated;
revoke all on function public.effective_thresholds(uuid, uuid) from public, anon, authenticated;
revoke all on function public.my_device_thresholds() from public, anon;
grant execute on function public.my_device_thresholds() to authenticated;
