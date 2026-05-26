import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "../app");
const JS = fs.readFileSync(path.join(APP, "dashboard-app.js"), "utf-8");
const BASE = fs.readFileSync(path.join(APP, "base.css"), "utf-8");
const THEME = fs.readFileSync(path.join(APP, "theme.css"), "utf-8");

export default function (app, ctx) {
  const base = "/api/plugins/" + ctx.pluginId;

  app.get("/dashboard/data", async c => {
    try {
      const cache = ctx._tokenCache;
      if (!cache?.ready || !cache.data) return c.json({ error: "数据未就绪" }, 503);
      const range = c.req.query("range") || "all";
      const agent = c.req.query("agent") || "";
      const model = c.req.query("model") || "";
      const type = c.req.query("type") || "";
      const from = c.req.query("from") || "";
      const to = c.req.query("to") || "";
      const provider = c.req.query("provider") || "";
      return c.json(build(cache.data, range, { agent, model, type, provider, from, to }));
    } catch(e) { return c.json({ error: e.message, stack: e.stack }, 500); }
  });

  app.post("/dashboard/refresh", async c => {
    try {
      const tk = ctx._tokenCache;
      if (tk?.fullScan) { await tk.fullScan(); return c.json({ ok: true, lastScan: tk.data?.lastScan }); }
      if (tk?.scan) { await tk.scan(true); return c.json({ ok: true, lastScan: tk.data?.lastScan }); }
      return c.json({ error: "unavailable" }, 503);
    } catch (err) { return c.json({ error: err.message }, 500); }
  });

  app.get("/dashboard", c => {
    const hc = c.req.query("hana-css") || "";
    const th = c.req.query("hana-theme") || "inherit";
    const hcLink = hc ? `<link rel="stylesheet" href="${esc(hc)}">` : "";
    return c.html(`<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Token 用量</title>
${hcLink}
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"><\/script>
<style>${BASE}${THEME}<\/style>
<\/head>
<body data-hana-theme="${esc(th)}" data-surface="page">
<div id="app"></div>
<script>(function(){window.parent.postMessage({source:"hana-plugin",type:"ready"},"*")})();<\/script>
<script>${JS}<\/script>
</body>
</html>`);
  });
}

// ── 后端数据构建 ──

function build(cache, range = "all", filters = {}) {
  let sessions = Object.values(cache.sessions);
  let earliest = null;
  for (const s of sessions) { if (s.firstTime) { const d = s.firstTime.slice(0, 10); if (!earliest || d < earliest) earliest = d; } }

  // ── 按时间维度确定过滤函数 ──
  let dateFilter = null;
  if (range !== "all") {
    const now = new Date();
    const today = cnToday();
    if (range === "today") {
      dateFilter = d => d === today;
    } else if (range === "week") {
      const day = now.getDay();
      const ws = new Date(now);
      ws.setDate(ws.getDate() - ((day + 6) % 7 + 1));
      const weekStart = ws.getFullYear() + "-" + String(ws.getMonth()+1).padStart(2,"0") + "-" + String(ws.getDate()).padStart(2,"0");
      dateFilter = d => d >= weekStart;
    } else if (range === "month") {
      const monthStart = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-01";
      dateFilter = d => d >= monthStart;
    }
  }

  // ── Agent / Provider / Type / 自定义日期筛选 ──
  const { agent: filterAgent, model: filterModel, type: filterType, provider: filterProvider, from, to } = filters;
  if (filterAgent) {
    sessions = sessions.filter(s => s.agent === filterAgent);
  }
  if (filterProvider) {
    sessions = sessions.filter(s => s.providers && Object.keys(s.providers).some(pk => pk.startsWith(filterProvider + "/")));
  }
  if (filterType) {
    sessions = sessions.filter(s => s.type === filterType);
  }
  if (from) {
    const orig = dateFilter;
    dateFilter = d => d >= from && (!to || d <= to) && (!orig || orig(d));
  }

  // 保存一份不含模型筛选的 sessions，用于前端下拉选项
  const sessionPool = sessions;

  if (filterModel) {
    sessions = sessions.filter(s => s.models?.[filterModel]);
  }

  // ── 统一汇总（无论什么维度都从 dailyBreakdown 取值） ──
  const agentMap = {};
  const modelMap = {};
  const dailyMap = {};
  const sums = { totalInput: 0, totalOutput: 0, totalTokens: 0, totalCacheRead: 0, totalAssistant: 0, totalDesktop: 0, totalChannel: 0 };

  for (const s of sessions) {
    const a = s.agent;

    // 会话级模型→供应商映射
    const provModels = {};
    if (s.providers) {
      for (const pk of Object.keys(s.providers)) {
        const sep = pk.indexOf("/");
        if (sep > 0) provModels[pk.slice(sep + 1)] = pk.slice(0, sep);
      }
    }

    // Agent / daily / sums <- dailyBreakdown
    for (const [day, d] of Object.entries(s.dailyBreakdown || {})) {
      if (dateFilter && !dateFilter(day)) continue;
      let di, dout, dcr, dtot, dasst;
      if (filterProvider && filterModel) {
        // 精确：优先用 providerTotals（仅 totalTokens 精确）
        const provPk = filterProvider + "/" + filterModel;
        const pt = d.providerTotals?.[provPk];
        if (pt !== undefined) {
          dtot = pt.totalTokens; di = pt.input; dout = pt.output; dcr = pt.cacheRead; dasst = 0;
        } else {
          di = 0; dout = 0; dcr = 0; dtot = 0; dasst = 0;
        }
      } else if (filterProvider && !filterModel) {
        di = 0; dout = 0; dcr = 0; dtot = 0; dasst = 0;
        if (d.providerTotals) {
          for (const [pk, pt] of Object.entries(d.providerTotals)) {
            if (pk.startsWith(filterProvider + "/")) {
              dtot += pt.totalTokens; di += pt.input; dout += pt.output; dcr += pt.cacheRead;
            }
          }
        }
      } else if (filterModel) {
        if (d.models?.[filterModel]) {
          const md = d.models[filterModel];
          di = md.input || 0; dout = md.output || 0; dcr = md.cacheRead || 0; dtot = md.totalTokens || 0; dasst = md.assistantCount || 0;
        } else {
          di = 0; dout = 0; dcr = 0; dtot = 0; dasst = 0;
        }
      } else {
        di = d.input || 0; dout = d.output || 0; dcr = d.cacheRead || 0; dtot = d.totalTokens || 0; dasst = d.assistantCount || 0;
      }

      if (!agentMap[a]) agentMap[a] = { input: 0, output: 0, totalTokens: 0, cacheRead: 0, assistantCount: 0, desktopTotal: 0, channelTotal: 0, models: {} };
      agentMap[a].input += di; agentMap[a].output += dout; agentMap[a].totalTokens += dtot; agentMap[a].cacheRead += dcr;
      agentMap[a].assistantCount += dasst;
      if (s.type === "desktop") agentMap[a].desktopTotal += dtot; else agentMap[a].channelTotal += dtot;

      if (!dailyMap[day]) dailyMap[day] = { totalTokens: 0, desktop: 0, channel: 0, cacheRead: 0 };
      dailyMap[day].totalTokens += dtot; dailyMap[day].cacheRead += dcr;
      if (s.type === "desktop") dailyMap[day].desktop += dtot; else dailyMap[day].channel += dtot;

      sums.totalInput += di; sums.totalOutput += dout; sums.totalTokens += dtot; sums.totalCacheRead += dcr;
      sums.totalAssistant += dasst;
      if (s.type === "desktop") sums.totalDesktop += dtot; else sums.totalChannel += dtot;

      // 模型精确统计（按日级数据，不按比例推算）
      for (const [mn, mv] of Object.entries(d.models || {})) {
        if (filterModel && mn !== filterModel) continue;
        if (filterProvider && !filterModel && provModels[mn] !== filterProvider) continue;
        if (!modelMap[mn]) modelMap[mn] = { input: 0, output: 0, cacheRead: 0, totalTokens: 0 };
        modelMap[mn].input += mv.input || 0;
        modelMap[mn].output += mv.output || 0;
        modelMap[mn].cacheRead += mv.cacheRead || 0;
        modelMap[mn].totalTokens += mv.totalTokens || 0;
        if (agentMap[a]) {
          if (!agentMap[a].models[mn]) agentMap[a].models[mn] = { input: 0, output: 0, cacheRead: 0, totalTokens: 0 };
          agentMap[a].models[mn].input += mv.input || 0;
          agentMap[a].models[mn].output += mv.output || 0;
          agentMap[a].models[mn].cacheRead += mv.cacheRead || 0;
          agentMap[a].models[mn].totalTokens += mv.totalTokens || 0;
        }
      }
    }
  }

  // ── 模型下拉选项（排除模型筛选，让前端下拉始终显示可用模型） ──
  const modelOptMap = {};
  for (const s of sessionPool) {
    const pmo = {};
    if (s.providers) {
      for (const pk of Object.keys(s.providers)) {
        const sp = pk.indexOf("/");
        if (sp > 0) pmo[pk.slice(sp + 1)] = pk.slice(0, sp);
      }
    }
    for (const [day, d] of Object.entries(s.dailyBreakdown || {})) {
      if (dateFilter && !dateFilter(day)) continue;
      for (const mn of Object.keys(d.models || {})) {
        if (filterProvider && pmo[mn] !== filterProvider) continue;
        modelOptMap[mn] = (modelOptMap[mn] || 0) + (d.models[mn].totalTokens || 0);
      }
    }
  }
  const modelOptions = Object.entries(modelOptMap).sort((a, b) => b[1] - a[1]).map(([id]) => ({ id }));

  // ── 供应商/模型组合饼图（受日期/Agent/类型/供应商筛选影响） ──
  const provBrkMap = {};
  var provAttributed = 0;
  var provDayTotal = 0;
  for (const s of sessions) {
    for (const [day, d] of Object.entries(s.dailyBreakdown || {})) {
      if (dateFilter && !dateFilter(day)) continue;
      provDayTotal += d.totalTokens || 0;
      if (d.providerTotals) {
        for (const [pk, pt] of Object.entries(d.providerTotals)) {
          if (filterProvider && !pk.startsWith(filterProvider + "/")) continue;
          if (filterModel && !pk.endsWith("/" + filterModel)) continue;
          if (!provBrkMap[pk]) {
            const sep = pk.indexOf("/");
            provBrkMap[pk] = { provider: pk.slice(0, sep), model: pk.slice(sep + 1), totalTokens: 0 };
          }
          provBrkMap[pk].totalTokens += pt.totalTokens;
          provAttributed += pt.totalTokens;
        }
      } else if (s.providers && d.models) {
        for (const [mn, mv] of Object.entries(d.models)) {
          const pk = Object.keys(s.providers).find(p => p.endsWith("/" + mn));
          if (!pk) continue;
          const pv = s.providers[pk];
          if (filterProvider && pv.provider !== filterProvider) continue;
          if (filterModel && pv.model !== filterModel) continue;
          if (!provBrkMap[pk]) provBrkMap[pk] = { provider: pv.provider, model: pv.model, totalTokens: 0 };
          provBrkMap[pk].totalTokens += mv.totalTokens || 0;
          provAttributed += mv.totalTokens || 0;
        }
      }
    }
  }
  const providerBreakdown = Object.values(provBrkMap).sort((a, b) => b.totalTokens - a.totalTokens);
  // 补上未归属的用量，使饼图总和 = 日数据总和（仅无供应商筛选时）
  var gap = provDayTotal - provAttributed;
  if (gap > 0 && !filterProvider && !filterModel) {
    providerBreakdown.push({ provider: "?", model: "未归属", totalTokens: gap });
  }

  const agents = Object.entries(agentMap).map(([id, d]) => ({ id, ...d })).sort((a, b) => b.totalTokens - a.totalTokens);
  const models = Object.entries(modelMap).map(([id, d]) => ({ id, ...d })).sort((a, b) => (b.input + b.output + (b.cacheRead || 0)) - (a.input + a.output + (a.cacheRead || 0)));
  const daily = Object.keys(dailyMap).sort().map(d => ({ date: d, totalTokens: dailyMap[d].totalTokens, desktop: dailyMap[d].desktop, channel: dailyMap[d].channel, cacheRead: dailyMap[d].cacheRead }));

  // ── 按小时汇总（今日或自定义单天） ──
  let hourly = null;
  let hourlyTargetDay = null;
  if (range === "today") {
    hourlyTargetDay = cnToday();
  } else if (from && to && from === to) {
    hourlyTargetDay = from;
  }
  if (hourlyTargetDay) {
    const hMap = {};
    for (const s of sessions) {
      const hb = s.hourlyBreakdown?.[hourlyTargetDay];
      if (!hb) continue;
      // 会话级模型→供应商映射
      const hp = {};
      if (s.providers) {
        for (const pk of Object.keys(s.providers)) {
          const sep = pk.indexOf("/");
          if (sep > 0) hp[pk.slice(sep + 1)] = pk.slice(0, sep);
        }
      }
      for (const [hour, v] of Object.entries(hb)) {
        if (!hMap[hour]) hMap[hour] = { totalTokens: 0, desktop: 0, channel: 0, cacheRead: 0 };
        if (filterProvider && filterModel) {
          const pk = filterProvider + "/" + filterModel;
          const vt = v.providerTotals?.[pk];
          if (vt !== undefined) {
            hMap[hour].totalTokens += vt.totalTokens;
            hMap[hour].desktop += vt.desktop || 0;
            hMap[hour].channel += vt.channel || 0;
            hMap[hour].cacheRead += vt.cacheRead;
          }
        } else if (filterProvider && !filterModel) {
          if (v.providerTotals) {
            // totalTokens 精确，desktop/channel/cacheRead 从 model 级推算
            for (const [pk, pt] of Object.entries(v.providerTotals)) {
              if (pk.startsWith(filterProvider + "/")) {
                hMap[hour].totalTokens += pt.totalTokens;
                hMap[hour].desktop += pt.desktop || 0;
                hMap[hour].channel += pt.channel || 0;
                hMap[hour].cacheRead += pt.cacheRead;
              }
            }
            for (const [mn, mv] of Object.entries(v.models || {})) {
              if (hp[mn] === filterProvider) {
                hMap[hour].desktop += mv.desktop || 0;
                hMap[hour].channel += mv.channel || 0;
                hMap[hour].cacheRead += mv.cacheRead || 0;
              }
            }
          } else if (v.models) {
            for (const [mn, mv] of Object.entries(v.models)) {
              if (hp[mn] === filterProvider) {
                hMap[hour].totalTokens += mv.totalTokens || 0; hMap[hour].desktop += mv.desktop || 0;
                hMap[hour].channel += mv.channel || 0; hMap[hour].cacheRead += mv.cacheRead || 0;
              }
            }
          }
        } else if (filterModel) {
          if (v.models?.[filterModel]) {
            const vm = v.models[filterModel];
            hMap[hour].totalTokens += vm.totalTokens || 0; hMap[hour].desktop += vm.desktop || 0; hMap[hour].channel += vm.channel || 0; hMap[hour].cacheRead += vm.cacheRead || 0;
          }
        } else {
          hMap[hour].totalTokens += v.totalTokens; hMap[hour].desktop += v.desktop; hMap[hour].channel += v.channel; hMap[hour].cacheRead += (v.cacheRead || 0);
        }
      }
    }
    hourly = Array.from({ length: 24 }, (_, h) => {
      const hh = String(h).padStart(2, "0");
      return { hour: hh, totalTokens: hMap[hh]?.totalTokens || 0, desktop: hMap[hh]?.desktop || 0, channel: hMap[hh]?.channel || 0, cacheRead: hMap[hh]?.cacheRead || 0 };
    });
  }

  // ── 对话流水 & 异常对话（不受筛选影响） ──
  var convs = [];
  for (const s of Object.values(cache.sessions)) {
    if (s.conversations) {
      for (const c of s.conversations) {
        convs.push({ time:c.time, userSnippet:c.userSnippet, userContent:c.userContent, model:c.model||"", provider:c.provider||"", totalTokens:c.totalTokens||0, msgCount:c.msgCount||0, toolCalls:c.toolCalls||[], steps:c.steps||[], agent:s.agent, agentName:(cache.agentNames && cache.agentNames[s.agent]) || s.agent });
      }
    }
  }
  convs.sort((a,b) => a.time < b.time ? 1 : (a.time > b.time ? -1 : 0));
  var stream = convs.slice(0, 100);
  var today = cnToday();
  var abnormal = convs.filter(function(c){if(!c.time)return false;var d=new Date(c.time);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")===today;}).sort(function(a,b){return b.totalTokens - a.totalTokens;}).slice(0, 10);

  // ── 供应商全量列表（不受筛选影响，用于前端下拉） ──
  const allProviders = {};
  for (const s of Object.values(cache.sessions)) {
    if (s.providers) for (const [pk, pv] of Object.entries(s.providers)) {
      if (!allProviders[pk]) allProviders[pk] = { provider: pv.provider, model: pv.model, totalTokens: 0, count: 0 };
      allProviders[pk].totalTokens += pv.totalTokens;
      allProviders[pk].count += pv.count;
    }
  }
  const allProviderList = Object.values(allProviders).sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    lastScan: cache.lastScan, agentNames: cache.agentNames || {}, earliest,
    summary: { ...sums, cacheHitRate: sums.totalTokens > 0 ? +((sums.totalCacheRead / sums.totalTokens * 100).toFixed(1)) : 0 },
    agents, models, modelOptions, providerBreakdown, providers: allProviderList, daily, hourly, stream, abnormal,
  };
}

function esc(v) { return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
function cnToday(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date())}
