// deno test --allow-env supabase/functions/ai/index.test.ts
Deno.env.set("AI_FUNCTION_TEST", "1");
const { buildRequest, callGemini, HttpError, modelChain, publishableKey } = await import("./index.ts");

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

  const noWait = async () => {};
  const limited = (async () => new Response("", { status: 429 })) as typeof fetch;
  await assertRejects(() => callGemini("hi", {}, limited, noWait), 429);
  const garbage = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }))) as typeof fetch;
  await assertRejects(() => callGemini("hi", {}, garbage, noWait), 502);
});

/** 依序回傳指定的狀態碼，並記錄呼叫了哪些模型。 */
function scripted(statuses: number[]) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url).match(/models\/([^:]+):/)![1]);
    const status = statuses.shift() ?? 200;
    return status === 200
      ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }))
      : new Response("busy", { status });
  }) as typeof fetch;
  return { impl, calls };
}

Deno.test("callGemini：503 重試、429/404 換模型、全部失敗時回報", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  for (const k of ["GEMINI_MODEL", "GEMINI_FALLBACK_MODEL", "GEMINI_FALLBACK_MODELS"]) Deno.env.delete(k);
  const noWait = async () => {};
  assertEquals(modelChain(), ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash"]);

  const retry = scripted([503, 200]);
  assertEquals(await callGemini("hi", {}, retry.impl, noWait), { ok: true });
  assertEquals(retry.calls, ["gemini-3.5-flash", "gemini-3.5-flash"]);

  const fallback = scripted([503, 503, 200]);
  assertEquals(await callGemini("hi", {}, fallback.impl, noWait), { ok: true });
  assertEquals(fallback.calls, ["gemini-3.5-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]);

  // 今天實際遇到的情況：主要模型額度用完、第一個備援忙碌
  const quota = scripted([429, 503, 503, 200]);
  assertEquals(await callGemini("hi", {}, quota.impl, noWait), { ok: true });
  assertEquals(quota.calls, ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);

  const retired = scripted([404, 200]);
  assertEquals(await callGemini("hi", {}, retired.impl, noWait), { ok: true });
  assertEquals(retired.calls, ["gemini-3.5-flash", "gemini-3.5-flash-lite"]);

  const allQuota = scripted([429, 429, 429, 429]);
  await assertRejects(() => callGemini("hi", {}, allQuota.impl, noWait), 429);
  assertEquals(allQuota.calls.length, 4);

  const down = scripted(Array(8).fill(503));
  await assertRejects(() => callGemini("hi", {}, down.impl, noWait), 503);
  assertEquals(down.calls.length, 8);

  const badRequest = scripted([400]);
  await assertRejects(() => callGemini("hi", {}, badRequest.impl, noWait), 502);
  assertEquals(badRequest.calls.length, 1);

  Deno.env.set("GEMINI_FALLBACK_MODELS", "a, b");
  assertEquals(modelChain(), ["gemini-3.5-flash", "a", "b"]);
  Deno.env.delete("GEMINI_FALLBACK_MODELS");
});

Deno.test("callGemini：請求逾時會換下一個模型", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url).match(/models\/([^:]+):/)![1]);
    if (calls.length <= 2) throw new DOMException("timed out", "TimeoutError");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }));
  }) as typeof fetch;
  assertEquals(await callGemini("hi", {}, impl, async () => {}), { ok: true });
  assertEquals(calls, ["gemini-3.5-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]);
});

Deno.test("thresholds：依週期列出各階段天數，並驗證輸入", async () => {
  const req = buildRequest({ task: "thresholds", plantName: "番茄", totalDays: 90 });
  assertEquals(req.task, "thresholds");
  assertEquals(req.prompt.includes("flowering 開花期：第 30~59 天"), true);
  assertEquals(req.prompt.includes("harvest 收成期：第 91 天之後"), true);
  assertEquals((req.schema as { required: string[] }).required, ["planting", "growing", "flowering", "fruiting", "harvest"]);
  await assertRejects(() => buildRequest({ task: "thresholds", plantName: "番茄", totalDays: 999 }), 400);
  await assertRejects(() => buildRequest({ task: "thresholds", totalDays: 90 }), 400);
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
