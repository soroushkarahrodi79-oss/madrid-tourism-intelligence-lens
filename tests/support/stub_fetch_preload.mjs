// Preload for the builder integration test: replaces global fetch so that
// scripts/build_runtime_poi.mjs runs offline. CRTM URLs are answered by the mock
// service described in CRTM_STUB (JSON: { metro, cercanias } scenario names);
// every other source answers 503 (the builder already tolerates that per layer).
import { makeCrtmRouter } from "./crtm_mock_service.mjs";

const scenario = JSON.parse(process.env.CRTM_STUB ?? "{}");
const abort = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

const hooksFor = (name) => ({
  ok: {},
  count_mismatch: { count: (b) => ({ ...b, count: b.count + 1 }) },
  timeout: { ids: () => { throw abort(); } },
  edited: { meta: (b, n) => (n === 2 ? { ...b, editingInfo: { ...b.editingInfo, dataLastEditDate: b.editingInfo.dataLastEditDate + 1000 } } : b) },
}[name ?? "ok"]);

const router = makeCrtmRouter({
  metro: { hooks: hooksFor(scenario.metro) },
  cercanias: { hooks: hooksFor(scenario.cercanias) },
});

globalThis.fetch = async (url) => {
  const body = await router.route(String(url));
  if (body === null) return new Response("unavailable", { status: 503 });
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
