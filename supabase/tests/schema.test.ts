// 在 PGlite（WebAssembly 版 PostgreSQL）中套用 schema.sql，驗證 RLS 與裝置函式。
// 執行：deno test --allow-read --allow-env --allow-net supabase/tests/schema.test.ts
import { PGlite } from "npm:@electric-sql/pglite@0.5.8";

const schema = await Deno.readTextFile(new URL("../schema.sql", import.meta.url));

// 模擬 Supabase 環境：auth schema、auth.uid()、anon / authenticated 角色
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
`;

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

async function setup() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(schema);
  await db.exec(schema); // 可重複執行
  await db.query(`insert into auth.users values ($1, '{"display_name":"小明","address":"臺北市大安區"}'), ($2, '{}')`, [A, B]);
  return db;
}

/** 以指定身分執行（uid 為 null 代表未登入的 anon）。 */
async function as<T>(db: PGlite, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

function eq(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function fails(p: Promise<unknown>, label: string) {
  try {
    await p;
  } catch {
    return;
  }
  throw new Error(`${label}: expected an error`);
}

Deno.test("註冊時自動建立 profile，且只能看到自己的", async () => {
  const db = await setup();
  const rows = await as(db, A, () => db.query("select display_name, address from profiles"));
  eq(rows.rows, [{ display_name: "小明", address: "臺北市大安區" }], "A 的 profile");
  const none = await as(db, null, () => db.query("select * from profiles").catch(() => ({ rows: "denied" })));
  eq(none.rows, "denied", "anon 不能讀 profiles");
});

Deno.test("種植專案與指南：只能存取自己的", async () => {
  const db = await setup();
  const { rows: [plant] } = await as(db, A, () =>
    db.query<{ id: string }>(`insert into plants (plant_name, total_days) values ('番茄', 90) returning id`));
  eq((await as(db, A, () => db.query("select plant_name from plants"))).rows, [{ plant_name: "番茄" }], "A 看得到");
  eq((await as(db, B, () => db.query("select * from plants"))).rows, [], "B 看不到");
  eq((await as(db, B, () => db.query(`update plants set plant_name = 'x' returning id`))).rows, [], "B 改不到");
  await fails(as(db, B, () => db.query(`insert into plants (user_id, plant_name, total_days) values ($1, 'x', 30)`, [A])), "B 不能替 A 建立");
  await fails(as(db, A, () => db.query(`insert into plants (plant_name, total_days) values ('x', 999)`)), "天數上限");
  await fails(as(db, B, () => db.query(`insert into plant_guides (plant_id, cache_key, payload) values ($1, 'k', '{}')`, [plant.id])), "B 不能寫入 A 植物的指南");
  await as(db, A, () => db.query(`insert into plant_guides (plant_id, cache_key, payload) values ($1, 'k', '{"a":1}')`, [plant.id]));
  await as(db, A, () => db.query(`delete from plants where id = $1`, [plant.id]));
  eq((await db.query("select count(*)::int as n from plant_guides")).rows, [{ n: 0 }], "刪除植物時一併刪除指南");
});

/** 以 A 的身分新增一塊裝置，回傳 id 與權杖。 */
async function addDevice(db: PGlite, uid: string, name: string, plantId: string | null = null) {
  const { rows: [d] } = await as(db, uid, () => db.query<{ id: string; token: string }>(
    `insert into devices (name, plant_id) values ($1, $2) returning id, token`, [name, plantId]));
  return d;
}

const syncAs = async (db: PGlite, token: string, args = "") =>
  (await as(db, null, () => db.query<{ r: Record<string, unknown> }>(`select device_sync($1${args}) as r`, [token]))).rows[0].r;

Deno.test("裝置與 device_sync：多塊裝置、上傳數據、取得門檻、限流、權杖更換", async () => {
  const db = await setup();
  const climate = await addDevice(db, A, "溫控節點");
  const soil = await addDevice(db, A, "土壤節點");
  await fails(as(db, null, () => db.query(`insert into devices (name) values ('x')`)), "anon 不能新增裝置");
  await fails(as(db, A, () => db.query(`insert into devices (name, token) values ('x', gen_random_uuid())`)), "不能自訂權杖");
  await fails(as(db, A, () => db.query(`update devices set token = gen_random_uuid()`)), "不能直接改權杖");
  await fails(as(db, A, () => db.query(`insert into devices (name) values ('')`)), "名稱不可空白");
  eq((await as(db, B, () => db.query("select * from devices"))).rows, [], "B 看不到 A 的裝置");

  await fails(as(db, null, () => db.query(`select device_sync(gen_random_uuid())`)), "錯誤權杖");
  const first = await syncAs(db, climate.token, ", null, 26.5, 70");
  eq([first.source, first.tempMax], ["default", 30], "沒設定時回傳預設值");
  await syncAs(db, soil.token, ", 42");
  eq((await db.query("select device_id, soil, temperature, humidity from sensor_readings order by id")).rows,
    [{ device_id: climate.id, soil: null, temperature: 26.5, humidity: 70 }, { device_id: soil.id, soil: 42, temperature: null, humidity: null }],
    "兩塊裝置各自上傳部分欄位，並記錄來源裝置");
  eq((await db.query<{ n: number }>("select count(*)::int as n from devices where last_seen_at is not null")).rows, [{ n: 2 }], "記錄上線時間");

  for (let i = 0; i < 10; i++) await syncAs(db, soil.token, ", 50");
  await syncAs(db, climate.token, ", null, 25, 60");
  eq((await db.query("select device_id, count(*)::int as n from sensor_readings group by device_id order by n")).rows,
    [{ device_id: climate.id, n: 2 }, { device_id: soil.id, n: 3 }], "每塊裝置每分鐘最多 3 筆，互不影響");
  await fails(as(db, null, () => db.query("select * from sensor_readings")), "anon 不能直接讀數據");
  eq((await as(db, B, () => db.query("select * from sensor_readings"))).rows, [], "B 看不到 A 的數據");

  await as(db, A, () => db.query(`insert into thresholds (temp_min, temp_max, soil_min) values (18, 28, 50)`));
  await fails(as(db, A, () => db.query(`update thresholds set temp_min = 40`)), "下限不可大於上限");
  const synced = await syncAs(db, climate.token);
  eq([synced.source, synced.tempMax, synced.soilMin], ["user", 28, 50], "回傳使用者設定");

  const newToken = (await as(db, A, () => db.query<{ t: string }>("select regenerate_device_token($1) as t", [climate.id]))).rows[0].t;
  if (newToken === climate.token) throw new Error("重新產生後應該不同");
  await fails(syncAs(db, climate.token), "舊權杖失效");
  await syncAs(db, newToken);
  await syncAs(db, soil.token);
  await fails(as(db, B, () => db.query("select regenerate_device_token($1)", [soil.id])), "B 不能更換 A 的權杖");

  await as(db, A, () => db.query(`delete from devices where id = $1`, [soil.id]));
  await fails(syncAs(db, soil.token), "刪除後權杖失效");
  eq((await db.query("select count(*)::int as n from sensor_readings where device_id is null")).rows, [{ n: 3 }], "刪除裝置保留歷史數據");

  for (let i = 0; i < 9; i++) await addDevice(db, A, `裝置 ${i}`);
  await fails(addDevice(db, A, "第 11 塊"), "每人最多 10 塊裝置");
});

Deno.test("從舊版（每人一組權杖）升級：保留權杖與控制模式", async () => {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(`
    create table public.plants (
      id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
      plant_name text not null, summary text not null default '', start_date date not null default current_date,
      total_days integer not null, created_at timestamptz not null default now());
    create table public.thresholds (
      user_id uuid primary key references auth.users (id) on delete cascade,
      temp_min real not null default 20, temp_max real not null default 30, humid_min real not null default 40,
      humid_max real not null default 80, soil_min real not null default 35, updated_at timestamptz not null default now(),
      mode text not null default 'manual', plant_id uuid references public.plants (id) on delete set null);
    create table public.devices (
      user_id uuid primary key references auth.users (id) on delete cascade,
      token uuid not null unique default gen_random_uuid(), created_at timestamptz not null default now());
  `);
  await db.query(`insert into auth.users values ($1, '{}'), ($2, '{}')`, [A, B]);
  const { rows: [plant] } = await db.query<{ id: string }>(
    `insert into plants (user_id, plant_name, total_days) values ($1, '番茄', 90) returning id`, [A]);
  await db.query(`insert into thresholds (user_id, mode, plant_id) values ($1, 'plan', $2), ($3, 'manual', null)`, [A, plant.id, B]);
  const token = "11111111-1111-1111-1111-111111111111";
  await db.query(`insert into devices (user_id, token) values ($1, $2), ($3, gen_random_uuid())`, [A, token, B]);

  await db.exec(schema);
  await db.exec(schema);
  eq((await db.query("select user_id, name, plant_id from devices order by user_id")).rows,
    [{ user_id: A, name: "溫控節點", plant_id: plant.id }, { user_id: B, name: "溫控節點", plant_id: null }], "搬移控制模式");
  eq((await db.query("select token from devices where user_id = $1", [A])).rows, [{ token }], "原權杖保留");
  eq((await db.query(`select column_name from information_schema.columns where table_name = 'thresholds' and column_name in ('mode', 'plant_id')`)).rows, [], "移除舊欄位");
  const r = (await as(db, null, () => db.query<{ r: Record<string, unknown> }>(`select device_sync($1, null, 25, 60) as r`, [token]))).rows[0].r;
  eq(r.source, "user", "沒有階段門檻時用手動門檻");
  await addDevice(db, A, "土壤節點");
});

const STAGE_SET = {
  planting: { tempMin: 18, tempMax: 26, humidMin: 60, humidMax: 85, soilMin: 55 },
  growing: { tempMin: 20, tempMax: 28, humidMin: 55, humidMax: 80, soilMin: 45 },
  flowering: { tempMin: 21, tempMax: 27, humidMin: 50, humidMax: 70, soilMin: 40 },
  fruiting: { tempMin: 22, tempMax: 30, humidMin: 50, humidMax: 70, soilMin: 45 },
  harvest: { tempMin: 18, tempMax: 30, humidMin: 40, humidMax: 70, soilMin: 30 },
};

Deno.test("生長階段計算與前端規則一致", async () => {
  const db = await setup();
  const { rows } = await db.query<{ s: string }>(
    `select public.growth_stage(d, 90) as s from unnest(array[1, 7, 8, 29, 30, 59, 60, 90, 91]) d`);
  eq(rows.map((r) => r.s), ["planting", "planting", "growing", "growing", "flowering", "flowering", "fruiting", "fruiting", "harvest"], "階段邊界");
});

Deno.test("階段門檻格式驗證", async () => {
  const db = await setup();
  const insert = (j: unknown) => as(db, A, () => db.query(
    `insert into plants (plant_name, total_days, stage_thresholds) values ('番茄', 90, $1::jsonb)`, [JSON.stringify(j)]));
  await insert(STAGE_SET);
  await fails(insert({ planting: { ...STAGE_SET.planting, tempMin: 30 } }), "下限大於上限");
  await fails(insert({ planting: { ...STAGE_SET.planting, soilMin: "50" } }), "數值必須是數字");
  await fails(insert({ winter: STAGE_SET.planting }), "未知的階段");
  await fails(insert({ planting: { tempMin: 18, tempMax: 26 } }), "缺欄位");
});

Deno.test("每塊裝置依指定植物的生長計畫切換門檻，且只能指定自己的植物", async () => {
  const db = await setup();
  // 番茄第 40 天（90 天週期）→ 開花期；羅勒第 3 天 → 種植期
  const { rows: [tomato] } = await as(db, A, () => db.query<{ id: string }>(
    `insert into plants (plant_name, total_days, start_date, stage_thresholds)
     values ('番茄', 90, (now() at time zone 'Asia/Taipei')::date - 39, $1::jsonb) returning id`, [JSON.stringify(STAGE_SET)]));
  const { rows: [basil] } = await as(db, A, () => db.query<{ id: string }>(
    `insert into plants (plant_name, total_days, start_date, stage_thresholds)
     values ('羅勒', 60, (now() at time zone 'Asia/Taipei')::date - 2, $1::jsonb) returning id`, [JSON.stringify(STAGE_SET)]));
  await as(db, A, () => db.query(`insert into thresholds (temp_min, temp_max) values (10, 40)`));
  const one = await addDevice(db, A, "溫室一", tomato.id);
  const two = await addDevice(db, A, "溫室二", basil.id);
  const manual = await addDevice(db, A, "陽台");

  let r = await syncAs(db, one.token);
  eq([r.source, r.plantName, r.stage, r.day, r.tempMin, r.tempMax, r.soilMin], ["plan", "番茄", "flowering", 40, 21, 27, 40], "裝置一：番茄開花期");
  r = await syncAs(db, two.token);
  eq([r.plantName, r.stage, r.tempMax], ["羅勒", "planting", 26], "裝置二：羅勒種植期");
  r = await syncAs(db, manual.token);
  eq([r.source, r.tempMin, r.tempMax], ["user", 10, 40], "沒指定植物的裝置用手動門檻");

  // 使用者把番茄進度調到第 70 天（結果期）
  await as(db, A, () => db.query(`update plants set start_date = (now() at time zone 'Asia/Taipei')::date - 69 where id = $1`, [tomato.id]));
  r = await syncAs(db, one.token);
  eq([r.stage, r.tempMax], ["fruiting", 30], "調整進度後改用結果期門檻");

  const mine = (await as(db, A, () => db.query<{ r: Record<string, unknown>[] }>("select my_device_thresholds() as r"))).rows[0].r;
  eq(mine.map((m) => [m.deviceId, m.source, m.stage ?? null]),
    [[one.id, "plan", "fruiting"], [two.id, "plan", "planting"], [manual.id, "user", null]], "網站看到的與裝置一致");
  eq((await as(db, B, () => db.query<{ r: unknown }>("select my_device_thresholds() as r"))).rows[0].r, [], "B 看不到 A 的裝置");

  // 改由別的植物控制、或改回手動
  await as(db, A, () => db.query(`update devices set plant_id = $1 where id = $2`, [basil.id, one.id]));
  eq((await syncAs(db, one.token)).plantName, "羅勒", "改由羅勒控制");
  await as(db, A, () => db.query(`update devices set plant_id = null where id = $1`, [one.id]));
  eq((await syncAs(db, one.token)).source, "user", "改回手動");

  // 植物沒有階段門檻時退回手動門檻
  await as(db, A, () => db.query(`update plants set stage_thresholds = null where id = $1`, [basil.id]));
  r = await syncAs(db, two.token);
  eq([r.source, r.tempMax], ["user", 40], "沒有階段門檻時用手動值");

  // 刪除植物 → plant_id 自動清空，不會出錯
  await as(db, A, () => db.query(`delete from plants where id = $1`, [basil.id]));
  eq((await syncAs(db, two.token)).source, "user", "植物刪除後仍可同步");

  // B 不能把 A 的植物設為控制來源
  await fails(as(db, B, () => db.query(`insert into devices (name, plant_id) values ('x', $1)`, [tomato.id])), "B 新增時不能指定 A 的植物");
  const bDev = await addDevice(db, B, "B 的裝置");
  await fails(as(db, B, () => db.query(`update devices set plant_id = $1 where id = $2`, [tomato.id, bDev.id])), "B 不能改成 A 的植物");
  eq((await as(db, B, () => db.query(`update devices set plant_id = null where id = $1 returning id`, [one.id]))).rows, [], "B 不能改 A 的裝置");
  await fails(as(db, null, () => db.query(`select effective_thresholds($1, $2)`, [A, tomato.id])), "anon 不能直接呼叫內部函式");
  await fails(as(db, B, () => db.query(`select effective_thresholds($1, $2)`, [A, tomato.id])), "B 不能查 A 的門檻");
});
