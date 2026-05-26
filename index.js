import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HANA_HOME || path.join(process.env.HOME || process.env.USERPROFILE, ".hanako");
const AGENTS = path.join(HOME, "agents");
const CACHE = "token-cache.json";
const CACHE_VERSION = 10;

export default class TokenTrackerPlugin {
  async onload() {
    const { dataDir, config, log } = this.ctx;
    const cachePath = path.join(dataDir, CACHE);
    const interval = (config.get("scanInterval") || 60) * 1000;
    const shared = { data: null, ready: false, cachePath };
    this.ctx._tokenCache = shared;
    // scan(force=false): 增量（靠 mtime），供定时器用
    // fullScan():        全量，供首次加载和刷新按钮用
    shared.scan = (force) => scanAll(shared, log, force);
    shared.fullScan = () => scanAll(shared, log, true);

    await shared.fullScan();
    const timer = setInterval(() => shared.scan(false), interval);
    timer.unref?.();
    this.register(() => clearInterval(timer));
    log.info(`token-tracker loaded (interval ${interval}ms)`);
  }
}

async function scanAll(shared, log, force) {
  const old = loadCache(shared.cachePath);
  const cache = old || { version: CACHE_VERSION, lastScan: null, sessions: {}, agentNames: {} };
  // 版本不匹配 或 外部强制 → 全量重扫（忽略旧 mtime）
  const full = force || cache.version !== CACHE_VERSION;
  cache.version = CACHE_VERSION;
  let changed = false;

  let dirs = [];
  try { dirs = fs.readdirSync(AGENTS).filter(n => fs.statSync(path.join(AGENTS, n)).isDirectory()); }
  catch { log.warn("agents dir not found"); return; }

  // Collect display names
  for (const id of dirs) {
    if (!cache.agentNames[id]) {
      try {
        const c = fs.readFileSync(path.join(AGENTS, id, "identity.md"), "utf-8");
        const m = c.match(/^#\s+(.+)/m);
        cache.agentNames[id] = m ? m[1].trim() : id;
      } catch { cache.agentNames[id] = id; }
    }
  }

  for (const agent of dirs) {
    changed = scanDir(path.join(AGENTS, agent, "sessions"), agent, "desktop", null, cache, full ? null : old) || changed;
    const arch = path.join(AGENTS, agent, "sessions", "archived");
    if (fs.existsSync(arch)) changed = scanDir(arch, agent, "desktop", null, cache, full ? null : old) || changed;
    const phone = path.join(AGENTS, agent, "phone", "sessions");
    if (fs.existsSync(phone)) {
      for (const sub of fs.readdirSync(phone)) {
        const sp = path.join(phone, sub);
        if (!fs.statSync(sp).isDirectory()) continue;
        changed = scanDir(sp, agent, "channel", sub.replace(/-[^-]+$/, ""), cache, full ? null : old) || changed;
      }
    }
  }

  // 保留最近5天的对话
  var cutoff5d = Date.now() - 5 * 86400000;
  for (const _key of Object.keys(cache.sessions)) {
    const _s = cache.sessions[_key];
    if (_s.conversations && _s.conversations.length) {
      var _before = _s.conversations.length;
      _s.conversations = _s.conversations.filter(function(c){ return new Date(c.time).getTime() >= cutoff5d; });
      if (_s.conversations.length !== _before) changed = true;
    }
  }

  if (changed) { cache.lastScan = new Date().toISOString(); saveCache(shared.cachePath, cache); }
  shared.data = cache;
  shared.ready = true;
}

function scanDir(dir, agent, type, channel, cache, old) {
  let changed = false;
  let conv = null;
  let files = [];
  try { files = fs.readdirSync(dir).filter(n => n.endsWith(".jsonl")); }
  catch { return false; }

  for (const fn of files) {
    const fp = path.join(dir, fn);
    const key = `${agent}::${type}::${channel||""}::${fn}`;
    let stat;
    try { stat = fs.statSync(fp); } catch { continue; }

    // 文件未变化则跳过
    const prev = old?.sessions?.[key];
    if (prev && prev.mtime === stat.mtimeMs) continue;

    const data = { agent, type, channelName: channel||null, filePath: fp, mtime: stat.mtimeMs, size: stat.size, fileName: fn, firstTime: null, lastTime: null, msgCount: 0, assistantCount: 0, input: 0, output: 0, cacheRead: 0, totalTokens: 0, cost: 0, models: {}, providers: {}, conversations: [] };

    try {
      var currentProvider = null;
      var _lastModel = null;
      for (const line of fs.readFileSync(fp, "utf-8").split("\n").filter(Boolean)) {
        let p;
        try { p = JSON.parse(line); } catch { continue; }
        if (p.type === "model_change" && p.provider) {
          currentProvider = p.provider;
          _lastModel = null;
          continue;
        }
        if (p.type !== "message" || !p.message) continue;
        const m = p.message;
        const ts = p.timestamp || m.timestamp || "";
        if (!data.firstTime) data.firstTime = ts;
        data.lastTime = ts;
        data.msgCount++;
        // 对话拆分
        if (m.role === "user") {
          if (conv) data.conversations.push(conv);
          var _txt = typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? m.content[0]?.text||"" : "");
          conv = { time: ts, userContent: _txt, userSnippet: _txt.slice(0,50), model: null, provider: null, totalTokens: 0, msgCount: 0, toolCalls: [], steps: [] };
        }
        if (m.role === "assistant" && conv) {
          conv.msgCount++;
          if (!conv.model) { conv.model = m.model; conv.provider = m.provider; }
          if (m.usage) { var _tot = m.usage.totalTokens || ((m.usage.input||0)+(m.usage.output||0)); conv.totalTokens += _tot; }
          if (Array.isArray(m.content)) {
            for (var _i=0; _i<m.content.length; _i++) {
              var _it = m.content[_i];
              if (!_it) continue;
              if (_it.type === "toolCall") {
                conv.toolCalls.push({ name: _it.name, args: _it.arguments });
                var _isFile = ["edit","write"].includes(_it.name);
                conv.steps.push({ t: _isFile ? "fm" : "tc", name: _it.name, args: _it.arguments });
              } else if (_it.type === "thinking") {
                conv.steps.push({ t: "th", c: _it.thinking || "" });
              } else if (_it.type === "text") {
                conv.steps.push({ t: "tx", c: _it.text || "" });
              }
            }
          } else if (typeof m.content === "string" && m.content) {
            conv.steps.push({ t: "tx", c: m.content });
          }
        }
        if (m.role === "assistant" && m.usage) {
          const msgProvider = m.provider || currentProvider;
          const u = m.usage;
          const inp = u.input||0, out = u.output||0, cr = u.cacheRead||0;
          const tot = u.totalTokens || (inp + out);
          const model = m.model || "unknown";
          data.assistantCount++; data.input += inp; data.output += out; data.cacheRead += cr; data.totalTokens += tot; data.cost += u.cost?.total || 0;
          // 模型变了但没有 model_change 事件 → 不知道供应商，不归属
          if (_lastModel !== null && _lastModel !== model) currentProvider = null;
          _lastModel = model;
          // 按天统计 — 存在会话自身上，不往 cache 里累加
          const d = new Date(ts); const day = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
          if (day) {
            if (!data.dailyBreakdown) data.dailyBreakdown = {};
            if (!data.dailyBreakdown[day]) data.dailyBreakdown[day] = { totalTokens:0, desktop:0, channel:0, input:0, output:0, cacheRead:0, assistantCount:0, models:{} };
            data.dailyBreakdown[day].totalTokens += tot;
            data.dailyBreakdown[day].input += inp;
            data.dailyBreakdown[day].output += out;
            data.dailyBreakdown[day].cacheRead += cr;
            data.dailyBreakdown[day].assistantCount += 1;
            if (type === "desktop") data.dailyBreakdown[day].desktop += tot;
            else data.dailyBreakdown[day].channel += tot;
            // 按 model 精确统计
            if (!data.dailyBreakdown[day].models[model]) data.dailyBreakdown[day].models[model] = { input:0, output:0, cacheRead:0, totalTokens:0, assistantCount:0 };
            data.dailyBreakdown[day].models[model].input += inp;
            data.dailyBreakdown[day].models[model].output += out;
            data.dailyBreakdown[day].models[model].cacheRead += cr;
            data.dailyBreakdown[day].models[model].totalTokens += tot;
            data.dailyBreakdown[day].models[model].assistantCount += 1;
            // 按供应商/模型统计
            if (msgProvider) {
              const pk = msgProvider + "/" + model;
              if (!data.dailyBreakdown[day].providerTotals) data.dailyBreakdown[day].providerTotals = {};
              if (!data.dailyBreakdown[day].providerTotals[pk]) data.dailyBreakdown[day].providerTotals[pk] = { totalTokens: 0, input: 0, output: 0, cacheRead: 0 };
              data.dailyBreakdown[day].providerTotals[pk].totalTokens += tot;
              data.dailyBreakdown[day].providerTotals[pk].input += inp;
              data.dailyBreakdown[day].providerTotals[pk].output += out;
              data.dailyBreakdown[day].providerTotals[pk].cacheRead += cr;
            }
            // 按小时统计 — 用于今日维度
            const hour = String(d.getHours()).padStart(2,"0");
            if (!data.hourlyBreakdown) data.hourlyBreakdown = {};
            if (!data.hourlyBreakdown[day]) data.hourlyBreakdown[day] = {};
            if (!data.hourlyBreakdown[day][hour]) data.hourlyBreakdown[day][hour] = { totalTokens:0, desktop:0, channel:0, cacheRead:0 };
            data.hourlyBreakdown[day][hour].totalTokens += tot;
            data.hourlyBreakdown[day][hour].cacheRead += cr;
            if (type === "desktop") data.hourlyBreakdown[day][hour].desktop += tot;
            else data.hourlyBreakdown[day][hour].channel += tot;
            if (!data.hourlyBreakdown[day][hour].models) data.hourlyBreakdown[day][hour].models = {};
            if (!data.hourlyBreakdown[day][hour].models[model]) data.hourlyBreakdown[day][hour].models[model] = { input:0, output:0, cacheRead:0, totalTokens:0, assistantCount:0, desktop:0, channel:0 };
            data.hourlyBreakdown[day][hour].models[model].input += inp;
            data.hourlyBreakdown[day][hour].models[model].output += out;
            data.hourlyBreakdown[day][hour].models[model].cacheRead += cr;
            data.hourlyBreakdown[day][hour].models[model].totalTokens += tot;
            data.hourlyBreakdown[day][hour].models[model].assistantCount += 1;
            if (type === "desktop") data.hourlyBreakdown[day][hour].models[model].desktop += tot;
            else data.hourlyBreakdown[day][hour].models[model].channel += tot;
            if (msgProvider) {
              const pk = msgProvider + "/" + model;
              if (!data.hourlyBreakdown[day][hour].providerTotals) data.hourlyBreakdown[day][hour].providerTotals = {};
              if (!data.hourlyBreakdown[day][hour].providerTotals[pk]) data.hourlyBreakdown[day][hour].providerTotals[pk] = { totalTokens: 0, input: 0, output: 0, cacheRead: 0, desktop: 0, channel: 0 };
              data.hourlyBreakdown[day][hour].providerTotals[pk].totalTokens += tot;
              data.hourlyBreakdown[day][hour].providerTotals[pk].input += inp;
              data.hourlyBreakdown[day][hour].providerTotals[pk].output += out;
              data.hourlyBreakdown[day][hour].providerTotals[pk].cacheRead += cr;
              if (type === "desktop") data.hourlyBreakdown[day][hour].providerTotals[pk].desktop += tot;
              else data.hourlyBreakdown[day][hour].providerTotals[pk].channel += tot;
            }
          }
          if (!data.models[model]) data.models[model] = { input: 0, output: 0, cacheRead: 0, count: 0 };
          data.models[model].input += inp; data.models[model].output += out; data.models[model].cacheRead += cr; data.models[model].count++;
          if (msgProvider) {
            const pk = msgProvider + "/" + model;
            if (!data.providers[pk]) data.providers[pk] = { provider: msgProvider, model, totalTokens: 0, count: 0, input: 0, output: 0, cacheRead: 0 };
            data.providers[pk].totalTokens += tot;
            data.providers[pk].count++;
            data.providers[pk].input += inp;
            data.providers[pk].output += out;
            data.providers[pk].cacheRead += cr;
          }
        }
      }
    } catch {}
    if (conv) { data.conversations.push(conv); conv = null; }
    data.title = (fn.match(/^(\d{4}-\d{2}-\d{2})/)||[])[1] || "unknown";
    cache.sessions[key] = data;
    changed = true;
  }
  return changed;
}

function loadCache(p) { try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; } }

function saveCache(p, data) {
  try { const dir = path.dirname(p); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch {}
}
