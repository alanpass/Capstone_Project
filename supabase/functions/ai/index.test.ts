// deno test --allow-env supabase/functions/ai/index.test.ts
Deno.env.set("AI_FUNCTION_TEST", "1");
const { buildRequest, callGemini, HttpError, publishableKey } = await import("./index.ts");

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function assertRejects(fn: () => unknown, status: number) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof HttpError && err.status === status) return;
    throw err;
  }
  throw new Error(`expected HttpError ${status}`);
}

Deno.test("check：名稱必填且截斷至 40 字", async () => {
  await assertRejects(() => buildRequest({ task: "check", plantName: "  " }), 400);
  const req = buildRequest({ task: "check", plantName: "番茄".repeat(30) });
  assertEquals(req.task, "check");
  assertEquals(req.prompt.includes("番茄".repeat(20) + "」"), true);
});

Deno.test("guide：環境資料會寫進提示詞，非數字欄位視為未知", () => {
  const req = buildRequest({
    task: "guide", plantName: "羅勒", day: 10, totalDays: 60, stage: "成長期",
    weather: { city: "臺北市", description: "陣雨", min_temp: 21.8, max_temp: 24.4, rain_chance: 100 },
    sensor: { soil: 42, temperature: "abc", humidity: null },
  });
  assertEquals(req.prompt.includes("第 10 天 / 共 60 天"), true);
  assertEquals(req.prompt.includes("臺北市）：陣雨，21.8~24.4°C"), true);
  assertEquals(req.prompt.includes("土壤濕度 42%、氣溫 未知°C"), true);
});

Deno.test("未知任務與缺欄位會回 400", async () => {
  await assertRejects(() => buildRequest({ task: "chat", prompt: "幫我寫作業" }), 400);
  await assertRejects(() => buildRequest({ task: "guide", plantName: "羅勒" }), 400);
});

Deno.test("callGemini：解析 JSON、處理限流與缺金鑰", async () => {
  Deno.env.delete("GEMINI_API_KEY");
  await assertRejects(() => callGemini("hi", {}), 503);

  Deno.env.set("GEMINI_API_KEY", "test-key");
  let sentKey = "";
  const ok = (async (_url: string, init: RequestInit) => {
    sentKey = (init.headers as Record<string, string>)["x-goog-api-key"];
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"is_plant":true}' }] } }] }));
  }) as typeof fetch;
  assertEquals(await callGemini("hi", {}, ok), { is_plant: true });
  assertEquals(sentKey, "test-key");

  const limited = (async () => new Response("", { status: 429 })) as typeof fetch;
  await assertRejects(() => callGemini("hi", {}, limited), 429);
  const garbage = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }))) as typeof fetch;
  await assertRejects(() => callGemini("hi", {}, garbage), 502);
});

Deno.test("publishableKey：優先使用新版 SUPABASE_PUBLISHABLE_KEYS，否則用舊版 anon key", async () => {
  Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "sb_publishable_new" }));
  Deno.env.set("SUPABASE_ANON_KEY", "legacy");
  assertEquals(publishableKey(), "sb_publishable_new");
  Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", "not json");
  assertEquals(publishableKey(), "legacy");
  Deno.env.delete("SUPABASE_PUBLISHABLE_KEYS");
  Deno.env.delete("SUPABASE_ANON_KEY");
  await assertRejects(() => publishableKey(), 500);
});
