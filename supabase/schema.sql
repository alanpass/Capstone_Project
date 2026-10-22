-- =====================================================================
-- 園藝智能助理 — Supabase 資料庫結構
-- 使用方式：Supabase Dashboard → SQL Editor → 貼上整份檔案 → Run
-- 可重複執行（會先移除舊的同名物件）。
-- 所有資料表都啟用 Row Level Security：使用者只能存取自己的資料。
-- ESP32 不登入，而是用「裝置權杖」呼叫 device_sync() 上傳數據並取得門檻值。
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

-- ---------- 裝置權杖（每位使用者一組，可重新產生） ----------
create table if not exists public.devices (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  token      uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

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
create policy "read own device" on public.devices
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "read own readings" on public.sensor_readings;
create policy "read own readings" on public.sensor_readings
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
grant select on public.devices to authenticated;
grant select, delete on public.sensor_readings to authenticated;
revoke all on public.profiles, public.plants, public.plant_guides, public.ai_requests,
  public.thresholds, public.devices, public.sensor_readings from anon;

-- =====================================================================
-- 函式
-- =====================================================================

-- 取得（或重新產生）目前使用者的裝置權杖，填到 ESP32 的 config.py
create or replace function public.device_token(regenerate boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  result uuid;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  insert into public.devices (user_id) values (uid) on conflict (user_id) do nothing;
  if regenerate then
    update public.devices set token = gen_random_uuid(), created_at = now() where user_id = uid;
  end if;
  select token into result from public.devices where user_id = uid;
  return result;
end;
$$;

-- ESP32 每個週期呼叫一次：上傳數據（可只傳部分欄位）並取得門檻值
create or replace function public.device_sync(
  p_token uuid,
  p_soil real default null,
  p_temperature real default null,
  p_humidity real default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  t public.thresholds;
begin
  select user_id into uid from public.devices where token = p_token;
  if uid is null then
    raise exception 'invalid device token' using errcode = '28000';
  end if;

  if coalesce(p_soil, p_temperature, p_humidity) is not null then
    -- 防止裝置程式錯誤狂送資料：同一使用者每分鐘最多 6 筆（兩塊 ESP32 各每分鐘 1 筆綽綽有餘）
    if (
      select count(*) from public.sensor_readings
      where user_id = uid and recorded_at > now() - interval '1 minute'
    ) < 6 then
      insert into public.sensor_readings (user_id, soil, temperature, humidity)
      values (
        uid,
        case when p_soil between 0 and 100 then p_soil end,
        case when p_temperature between -40 and 80 then p_temperature end,
        case when p_humidity between 0 and 100 then p_humidity end
      );
      -- 只保留 90 天，免費方案的空間就夠用
      delete from public.sensor_readings where user_id = uid and recorded_at < now() - interval '90 days';
    end if;
  end if;

  select * into t from public.thresholds where user_id = uid;
  return json_build_object(
    'tempMin',  coalesce(t.temp_min, 20),
    'tempMax',  coalesce(t.temp_max, 30),
    'humidMin', coalesce(t.humid_min, 40),
    'humidMax', coalesce(t.humid_max, 80),
    'soilMin',  coalesce(t.soil_min, 35),
    'source',   case when t.user_id is null then 'default' else 'user' end
  );
end;
$$;

revoke all on function public.device_token(boolean) from public, anon;
grant execute on function public.device_token(boolean) to authenticated;
revoke all on function public.device_sync(uuid, real, real, real) from public;
grant execute on function public.device_sync(uuid, real, real, real) to anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
