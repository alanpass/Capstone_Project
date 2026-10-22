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

Deno.test("裝置權杖與 device_sync：上傳數據、取得門檻、限流、權杖更換", async () => {
  const db = await setup();
  const token = (await as(db, A, () => db.query<{ t: string }>("select device_token() as t"))).rows[0].t;
  eq((await as(db, A, () => db.query<{ t: string }>("select device_token() as t"))).rows[0].t, token, "權杖固定");
  await fails(as(db, null, () => db.query("select device_token()")), "anon 不能取得權杖");

  await fails(as(db, null, () => db.query(`select device_sync(gen_random_uuid())`)), "錯誤權杖");
  const first = await as(db, null, () => db.query<{ r: Record<string, unknown> }>(`select device_sync($1, 42, 26.5, null) as r`, [token]));
  eq([first.rows[0].r.source, first.rows[0].r.tempMax], ["default", 30], "沒設定時回傳預設值");
  await as(db, null, () => db.query(`select device_sync($1, null, 25, 70)`, [token]));
  eq((await db.query("select soil, temperature, humidity from sensor_readings order by id")).rows,
    [{ soil: 42, temperature: 26.5, humidity: null }, { soil: null, temperature: 25, humidity: 70 }], "兩塊裝置各自上傳部分欄位");
  for (let i = 0; i < 10; i++) await as(db, null, () => db.query(`select device_sync($1, 50)`, [token]));
  eq((await db.query("select count(*)::int as n from sensor_readings")).rows, [{ n: 6 }], "每分鐘最多 6 筆");
  await as(db, null, () => db.query(`select device_sync($1, 150, 200, -5)`, [token]));
  await fails(as(db, null, () => db.query("select * from sensor_readings")), "anon 不能直接讀數據");
  eq((await as(db, B, () => db.query("select * from sensor_readings"))).rows, [], "B 看不到 A 的數據");

  await as(db, A, () => db.query(`insert into thresholds (temp_min, temp_max, soil_min) values (18, 28, 50)`));
  await fails(as(db, A, () => db.query(`update thresholds set temp_min = 40`)), "下限不可大於上限");
  const synced = await as(db, null, () => db.query<{ r: Record<string, unknown> }>(`select device_sync($1) as r`, [token]));
  eq([synced.rows[0].r.source, synced.rows[0].r.tempMax, synced.rows[0].r.soilMin], ["user", 28, 50], "回傳使用者設定");

  const newToken = (await as(db, A, () => db.query<{ t: string }>("select device_token(true) as t"))).rows[0].t;
  if (newToken === token) throw new Error("重新產生後應該不同");
  await fails(as(db, null, () => db.query(`select device_sync($1)`, [token])), "舊權杖失效");
});
