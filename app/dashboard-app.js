// dashboard-app.js — Token 用量仪表盘
(function(){
"use strict";

var D, R = "all", tc, mc, ac, _allAgents = null, _allModels = null, _allProviders = null, _selAgent = "", _selModel = "", _selProvider = "", _selType = "", _provNames = null;
(function(){ try{_provNames=JSON.parse(localStorage.getItem("tt-prov-names")||"{}");}catch(e){_provNames={};} })();

function $(id) { return document.getElementById(id); }
function fmt(n) { if(!n||n===0) return "0"; if(n>=1e6) return (n/1e6).toFixed(1)+"M"; if(n>=1e3) return (n/1e3).toFixed(1)+"k"; return n.toLocaleString(); }
function _pn(p) { return (_provNames && _provNames[p]) || p; }

function cnToday(){return new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Shanghai"})}

// ── 主题 ──
function initTheme() {
  let saved;
  try { saved = localStorage.getItem("token-tracker-theme"); } catch(e) {}
  const theme = saved || "dark";
  document.body.setAttribute("data-theme", theme);
  var opts=$("st")?.querySelectorAll(".cs-opt");
  if(opts)opts.forEach(function(o){o.classList.toggle("sel",o.dataset.v===theme)});
  var tx=$("st")?.querySelector(".cs-txt");
  if(tx){
    var so=$("st")?.querySelector(".cs-opt.sel");
    tx.textContent=so?so.textContent:theme;
  }
}

function chartColors() {
  const s = getComputedStyle(document.body);
  return {
    text: s.getPropertyValue("--chart-text").trim(),
    grid: s.getPropertyValue("--chart-grid").trim(),
    chat: s.getPropertyValue("--chart-bar-chat").trim(),
    channel: s.getPropertyValue("--chart-bar-channel").trim(),
    doughnut: s.getPropertyValue("--chart-doughnut-colors").trim().split(",").map(c => c.trim()),
    agent: s.getPropertyValue("--chart-agent-colors").trim().split(",").map(c => c.trim()),
    hitRate: s.getPropertyValue("--chart-hit-rate").trim(),
  };
}

// ── 判断当前是否为按小时模式 ──
function isHourlyMode() {
  if (R === "today") return true;
  const df = $("df"), dt = $("dt");
  if (df && dt && df.value && dt.value && df.value === dt.value) return true;
  return false;
}

function syncDateInputs() {
  var df=$("df"),dt=$("dt");
  if(!df||!dt)return;
  var t=cnToday();
  if(R==="today"){df.value=t;dt.value=t;}
  else if(R==="week"){
    var d=new Date(),day=d.getDay();
    d.setDate(d.getDate()-((day+6)%7+1));
    df.value=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");dt.value=t;
  }else if(R==="month"){
    var d=new Date();
    df.value=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-01";dt.value=t;
  }else if(R==="all"){
    df.value=(D&&D.earliest)?D.earliest:"";dt.value=D?t:"";
  }
}

function updateFilterOpts() {
  var sa=$("sa"),sp=$("sp"),sm=$("sm"); if(!sa||!sm) return;
  var la=sa.querySelector(".cs-list"),lp=sp?.querySelector(".cs-list"),lm=sm.querySelector(".cs-list");
  var ta=sa.querySelector(".cs-txt"),tp=sp?.querySelector(".cs-txt"),tm=sm.querySelector(".cs-txt");
  if(!la||!lm||!ta||!tm) return;
  ta.textContent=_selAgent?((D.agentNames||{})[_selAgent]||_selAgent):"所有 Agent";
  if(tp){
    if(_selProvider)tp.textContent=_pn(_selProvider);
    else tp.textContent="供应商";
  }
  tm.textContent=_selModel||"所有模型";
  if(_allAgents) {
    var h='<div class="cs-opt'+(_selAgent===""?" sel":"")+'" data-v="">所有 Agent</div>';
    _allAgents.forEach(function(a){var n=(D.agentNames||{})[a.id]||a.id;h+='<div class="cs-opt'+(_selAgent===a.id?" sel":"")+'" data-v="'+a.id+'">'+n+'</div>'});
    la.innerHTML=h;
  }
    if(sp&&lp&&D&&D.providers){
    var seen={},ph='<div class="cs-opt'+(_selProvider===""?" sel":"")+'" data-v="">全部</div>';
    D.providers.forEach(function(p){if(!seen[p.provider]){seen[p.provider]=1;ph+='<div class="cs-opt'+(_selProvider===p.provider?" sel":"")+'" data-v="'+p.provider+'">'+_pn(p.provider)+'</div>'}});
    lp.innerHTML=ph;
  }
  if(_allModels || D.modelOptions) {
    var h='<div class="cs-opt'+(_selModel===""?" sel":"")+'" data-v="">所有模型</div>';
    var filtered=D.modelOptions||_allModels||[];
    filtered.forEach(function(m){h+='<div class="cs-opt'+(_selModel===m.id?" sel":"")+'" data-v="'+m.id+'">'+m.id+'</div>'});
    lm.innerHTML=h;
  }
}

// ── DOM ──
$("app").innerHTML =
  '<div class="hdr"><div class="hdr-left"><span class="hdr-title">Token 用量</span><span class="bal" id="bal" style="display:none"></span></div><div class="hdr-right"><span id="lu">—</span><div class="rt"><button class="btn" id="rf">刷新</button><button class="btn" id="st-btn">设置</button><span class="cs" id="st"><span class="cs-txt">暗色模式</span><span class="cs-arw">▾</span><div class="cs-list"><div class="cs-opt sel" data-v="dark">暗色模式</div><div class="cs-opt" data-v="light">亮色模式</div><div class="cs-opt" data-v="护眼-暖黄">护眼-暖黄</div><div class="cs-opt" data-v="护眼-深色">护眼-深色</div><div class="cs-opt" data-v="护眼-灰阶">护眼-灰阶</div><div class="cs-opt" data-v="护眼-绿豆">护眼-绿豆</div><div class="cs-opt" data-v="护眼-琥珀">护眼-琥珀</div></div></span></div></div></div>'+
  '<div class="flt">'+
  '<button class="fb act" data-r="all">全部</button><button class="fb" data-r="month">本月</button>'+
  '<button class="fb" data-r="week">本周</button><button class="fb" data-r="today">今日</button>'+
  '<span class="fi-wrap"><input type="text" readonly class="fi" id="df"></span><span class="fi-wrap"><input type="text" readonly class="fi" id="dt"></span>'+
  '<span class="fd"></span>'+
  '<span class="cs" id="sa"><span class="cs-txt">所有 Agent</span><span class="cs-arw">▾</span><div class="cs-list"></div></span>'+
  '<span class="cs" id="sp"><span class="cs-txt">供应商</span><span class="cs-arw">▾</span><div class="cs-list"></div></span>'+
  '<span class="cs" id="sm"><span class="cs-txt">所有模型</span><span class="cs-arw">▾</span><div class="cs-list"></div></span>'+
  '<span class="cs" id="stype"><span class="cs-txt">会话类型</span><span class="cs-arw">▾</span><div class="cs-list"><div class="cs-opt sel" data-v="">全部</div><div class="cs-opt" data-v="desktop">聊天</div><div class="cs-opt" data-v="channel">频道</div></div></span></div>'+
  '<div id="cards" class="cg"></div>'+
  '<div class="cx"><div class="ct" id="tc-title">消耗趋势</div><canvas id="tc" height="220"></canvas></div>'+
  '<div class="d2"><div class="cx"><div class="ct">模型占比</div><canvas id="mc" height="220"></canvas></div>'+
  '<div class="cx"><div class="ct">Agent 消耗对比</div><canvas id="ac" height="220"></canvas></div></div>'+
  '<div class="cg2"><div class="cx cx-ano"><div class="ct">⚠ 异常对话（今日前10）</div><div id="ano-list" class="cv-list"></div></div><div class="cx cx-stream"><div class="ct">📋 对话流水（最近100条）</div><div id="stream-list" class="cv-list"></div></div></div>'+
  '<div id="ld" class="ld">加载中...</div>'+
  '<div class="set-shade" id="set-shade" style="display:none"></div><div class="set-panel" id="set-panel" style="display:none"><div class="set-hdr"><span>设置</span><button class="btn" id="set-close">✕</button></div><div class="set-body"><div class="set-sec"><div class="set-sec-title">DeepSeek余额显示</div><div class="set-row"><label>DeepSeek API Key</label><input type="password" id="set-ds-key" class="set-inp" placeholder="sk-..."></div></div><div class="set-sec"><div class="set-sec-title">供应商显示名</div><div id="set-prov-names" class="set-prov-list"></div></div><button class="btn" id="set-save" style="margin-top:8px">保存</button></div></div>'+
  '<div id="modal" class="modal" style="display:none"><div class="modal-bg"></div><div class="modal-box"><div class="modal-hdr"><span class="modal-tit">对话详情</span><button class="btn" onclick="document.getElementById(\'modal\').style.display=\'none\'">✕</button></div><div class="modal-body" id="modal-body"></div></div></div>';

// ── 通用图表配置 ──
function barChart(canvas, labels, datasets, cc) {
  return new Chart(canvas, {type:"bar",data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,color:cc.text,scales:{x:{stacked:true,grid:{color:cc.grid}},y:{stacked:true,grid:{color:cc.grid},ticks:{callback:v=>fmt(v)}}}}});
}

// ── 加载 ──
function load(refreshFirst) {
  const el = $("ld"); if (el) el.style.display = "block";
  const qs = window.location.search;
  const sep = qs ? '&' : '?';

  var p = "range="+R+($("df").value?"&from="+$("df").value:"")+($("dt").value?"&to="+$("dt").value:"")+(_selAgent?"&agent="+encodeURIComponent(_selAgent):"")+(_selProvider?"&provider="+encodeURIComponent(_selProvider):"")+(_selModel?"&model="+encodeURIComponent(_selModel):"")+(_selType?"&type="+_selType:"");
  const doFetch = () => fetch(window.location.pathname + "/data" + qs + sep + p).then(r => {
    if (!r.ok) throw Error(r.statusText);
    return r.json();
  }).then(d => {
    if (d.error) { if (el) el.textContent = d.error; return; }
    if(!_allAgents||!D){_allAgents=d.agents.slice();_allModels=d.models.slice();_allProviders=d.providers?d.providers.slice():null}
    D = d; if (el) el.style.display = "none";
    render();
    fetchBalance();
  }).catch(e => { if (el) el.textContent = "加载失败: "+e.message; });

  if (refreshFirst) {
    fetch(window.location.pathname + "/refresh" + qs + sep + "range=" + R, {method: "POST"})
      .then(doFetch).catch(doFetch);
  } else {
    doFetch();
  }
}

function refresh() { load(true); }

// ── 渲染 ──
function render() {
  if (!D) return;
  syncDateInputs();
  updateFilterOpts();
  $("lu").textContent = D.lastScan ? "上次更新: "+new Date(D.lastScan).toLocaleString("zh-CN") : "";
  $("cards").innerHTML =
    '<div class="cd"><div class="cl">总消耗</div><div class="cv">'+fmt(D.summary.totalTokens)+'</div></div>'+
    '<div class="cd"><div class="cl">聊天</div><div class="cv">'+fmt(D.summary.totalDesktop)+'</div></div>'+
    '<div class="cd"><div class="cl">频道</div><div class="cv">'+fmt(D.summary.totalChannel)+'</div></div>'+
    '<div class="cd"><div class="cl">输出</div><div class="cv">'+fmt(D.summary.totalOutput)+'</div></div>'+
    '<div class="cd"><div class="cl">输入(未命中)</div><div class="cv">'+fmt(D.summary.totalInput)+'</div></div>'+
    '<div class="cd"><div class="cl">输入(命中)</div><div class="cv">'+fmt(D.summary.totalCacheRead)+'</div></div>'+
    '<div class="cd"><div class="cl">缓存命中率</div><div class="cv">'+(D.summary.cacheHitRate||0)+'%</div></div>';
  renderTrend();
  renderModel();
  renderAgent();
  renderConversations();
}

function renderTrend() {
  if (tc) tc.destroy();
  const cc = chartColors();
  const useHourly = isHourlyMode() && D.hourly && D.hourly.length > 0;
  let data = useHourly ? D.hourly : D.daily;

  $("tc-title").textContent = useHourly ? "消耗趋势（按小时）" : "消耗趋势";
  if (!data || !data.length) return;

  // 按 range 截断显示范围（仅 daily 模式）
  if (!useHourly) {
    const now = new Date();
    let startDate;
    if (R === "all") {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      startDate = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
    } else if (R === "month") {
      startDate = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-01";
    } else if (R === "week") {
      const d = new Date();
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7 + 1));
      startDate = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
    }
    if (startDate) data = data.filter(d => d.date >= startDate);
  }

  const labels = data.map(d => useHourly ? d.hour+":00" : d.date.slice(5));
  const desk = data.map(d => d.desktop||0);
  const chan = data.map(d => d.channel||0);
  var hitRate = data.map(function(d){return d.totalTokens>0?+((d.cacheRead/d.totalTokens*100).toFixed(1)):0});
  tc = new Chart($("tc"),{type:"bar",data:{labels,datasets:[
    {label:"聊天",data:desk,backgroundColor:cc.chat,borderRadius:4},
    {label:"频道",data:chan,backgroundColor:cc.channel,borderRadius:4},
    {type:"line",label:"缓存命中率",data:hitRate,borderColor:cc.hitRate,yAxisID:"y1",pointRadius:2,tension:.3,fill:false}
  ]},options:{responsive:true,maintainAspectRatio:false,color:cc.text,scales:{x:{stacked:true,grid:{color:cc.grid}},y:{stacked:true,grid:{color:cc.grid},ticks:{callback:function(v){return fmt(v)}}},y1:{stacked:false,position:"right",min:0,max:100,grid:{display:false},ticks:{callback:function(v){return v+"%"}}}}}});
}

function renderModel() {
  const cc = chartColors(); if (mc) mc.destroy();
  var smv=$("sm")?_selModel:"";
  // 选了模型没选 Agent → Agent 饼图
  if (smv && !_selAgent) {
    var ag=D.agents; if(!ag||!ag.length)return;
    $("mc").parentElement.querySelector(".ct").textContent="Agent 占比";
    mc = new Chart($("mc"),{type:"doughnut",data:{labels:ag.map(function(a){return(D.agentNames||{})[a.id]||a.id}),datasets:[{data:ag.map(function(a){return a.totalTokens}),backgroundColor:cc.agent.slice(0,ag.length)}]},options:{responsive:true,maintainAspectRatio:false,color:cc.text,plugins:{legend:{labels:{color:cc.text,boxWidth:10,font:{size:11}},display:true,position:"bottom"},tooltip:{callbacks:{label:function(ctx){var t=ctx.dataset.data.reduce(function(a,b){return a+b},0);return ctx.label+": "+fmt(ctx.parsed)+" ("+((ctx.parsed/t*100).toFixed(1))+"%)";}}}}}});
    return;
  }
  // 有供应商/模型组合数据时，始终用它显示（和卡片同源）
  if (D.providerBreakdown && D.providerBreakdown.length) {
    var pTitle = "模型占比";
    var pLabels = _selProvider
      ? D.providerBreakdown.map(function(p){return p.model})
      : D.providerBreakdown.map(function(p){return _pn(p.provider)+"/"+p.model});
    $("mc").parentElement.querySelector(".ct").textContent=pTitle;
    mc = new Chart($("mc"),{type:"doughnut",data:{labels:pLabels,datasets:[{data:D.providerBreakdown.map(function(p){return p.totalTokens}),backgroundColor:cc.doughnut.slice(0,D.providerBreakdown.length)}]},options:{responsive:true,maintainAspectRatio:false,color:cc.text,plugins:{legend:{labels:{color:cc.text,boxWidth:10,font:{size:11}},display:true,position:"bottom"},tooltip:{callbacks:{label:function(ctx){var t=ctx.dataset.data.reduce(function(a,b){return a+b},0);return ctx.label+": "+fmt(ctx.parsed)+" ("+((ctx.parsed/t*100).toFixed(1))+"%)";}}}}}});
    return;
  }
  // 模型占比（降级）
  var m=D.models; if(!m||!m.length)return;
  $("mc").parentElement.querySelector(".ct").textContent="模型占比";
  mc = new Chart($("mc"),{type:"doughnut",data:{labels:m.map(function(md){return md.id}),datasets:[{data:m.map(function(md){return md.totalTokens||0}),backgroundColor:cc.doughnut.slice(0,m.length)}]},options:{responsive:true,maintainAspectRatio:false,color:cc.text,plugins:{legend:{labels:{color:cc.text,boxWidth:10,font:{size:11}},display:true,position:"bottom"},tooltip:{callbacks:{label:function(ctx){var t=ctx.dataset.data.reduce(function(a,b){return a+b},0);return ctx.label+": "+fmt(ctx.parsed)+" ("+((ctx.parsed/t*100).toFixed(1))+"%)";}}}}}});
}

function renderAgent() {
  const cc = chartColors(); if (ac) ac.destroy();
  if (_selAgent && !_selModel) {
    var ag=D.agents.find(function(a){return a.id===_selAgent}); if(!ag||!ag.models)return;
    var mods=Object.entries(ag.models).sort(function(a,b){return(b[1].totalTokens||0)-(a[1].totalTokens||0)});
    if(!mods.length)return;
    $("ac").parentElement.querySelector(".ct").textContent="模型占比";
    ac = new Chart($("ac"),{type:"bar",data:{labels:mods.map(function(m){return m[0]}),datasets:[{label:"消耗",data:mods.map(function(m){return m[1].totalTokens||0}),backgroundColor:cc.doughnut.slice(0,mods.length),borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,color:cc.text,indexAxis:"y",scales:{x:{grid:{color:cc.grid},ticks:{callback:function(v){return fmt(v)}}}},plugins:{legend:{display:false}}}});
  } else {
    var ags=D.agents; if(!ags||!ags.length)return;
    $("ac").parentElement.querySelector(".ct").textContent="Agent 消耗对比";
    ac = new Chart($("ac"),{type:"bar",data:{labels:ags.map(function(a){return(D.agentNames||{})[a.id]||a.id}),datasets:[{label:"消耗",data:ags.map(function(a){return a.totalTokens}),backgroundColor:cc.agent.slice(0,ags.length),borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,color:cc.text,indexAxis:"y",scales:{x:{grid:{color:cc.grid},ticks:{callback:function(v){return fmt(v)}}}},plugins:{legend:{display:false}}}});
  }
}

var _CV=[];
function renderConversations(){
  _CV=[];
  function mkItem(c){
    _CV.push(c);
    var idx=_CV.length-1;
    var t=c.time?new Date(c.time).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Shanghai"}):"";
    var tc=c.toolCalls&&c.toolCalls.length?'<span class="cv-tb">⚙'+c.toolCalls.length+'</span>':'';
    var s=c.userSnippet||"(空)";
    var tk=fmt(c.totalTokens||0);
    return '<div class="cv-it" data-cv="'+idx+'"><div class="cv-qt">'+s+tc+'</div><div class="cv-meta">'+(c.agentName||c.agent)+' · '+t+' · '+(c.provider?_pn(c.provider)+' / ':'')+c.model+' · '+tk+' tok</div></div>';
  }
  function fill(id,arr){
    var el=$(id);if(!el)return;
    if(!arr||!arr.length){el.innerHTML='<div class="cv-empty">暂无数据</div>';return;}
    el.innerHTML=arr.map(function(c){return mkItem(c);}).join('');
  }
  fill("ano-list",D.abnormal);
  fill("stream-list",D.stream);
}
function _showCv(idx){
  var c=_CV[idx];if(!c)return;
  var b=$("modal-body");if(!b)return;
  var t=c.time?new Date(c.time).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"-";
  var html='<div class="cv-dt"><div class="cv-dt-hdr">'+(c.agentName||c.agent)+' · '+t+' · '+(c.provider?_pn(c.provider)+' / ':'')+c.model+'</div>';
  html+='<div class="cv-dt-msg cv-dt-user">'+escHTML(c.userContent||"")+'</div>';
  if(c.steps&&c.steps.length){
    for(var _s=0;_s<c.steps.length;_s++){
      var st=c.steps[_s];
      if(st.t==="th"){
        html+='<div class="cv-step cv-step-th"><div class="cv-step-label">💭 思考</div><div class="cv-step-cnt">'+escHTML(st.c||"")+'</div></div>';
      }else if(st.t==="tc"){
        html+='<div class="cv-step cv-step-tc"><div class="cv-step-label">⚙ 工具调用</div><div><strong>'+escHTML(st.name||"")+'</strong><pre class="cv-step-code">'+escHTML(JSON.stringify(st.args,null,2))+'</pre></div></div>';
      }else if(st.t==="fm"){
        html+='<div class="cv-step cv-step-fm"><div class="cv-step-label">📝 修改文件</div><div><strong>'+escHTML(st.name||"")+'</strong><pre class="cv-step-code">'+escHTML(JSON.stringify(st.args,null,2))+'</pre></div></div>';
      }else if(st.t==="tx"){
        html+='<div class="cv-step cv-step-tx"><div class="cv-step-label">💬 回答</div><div class="cv-step-cnt">'+escHTML(st.c||"")+'</div></div>';
      }
    }
  }else if(c.toolCalls&&c.toolCalls.length){
    for(var _j=0;_j<c.toolCalls.length;_j++){
      var tc=c.toolCalls[_j];
      html+='<div class="cv-step cv-step-tc"><div class="cv-step-label">⚙ 工具调用</div><div><strong>'+escHTML(tc.name||"")+'</strong><pre class="cv-step-code">'+escHTML(JSON.stringify(tc.args,null,2))+'</pre></div></div>';
    }
  }
  html+='<div class="cv-dt-sum">总消耗 '+fmt(c.totalTokens||0)+' tokens · '+(c.msgCount||0)+' 条消息</div></div>';
  b.innerHTML=html;
  var m=$("modal");if(m)m.style.display="";
}
function escHTML(s){if(!s)return'';return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

function fetchBalance(){
  var el=$("bal");if(!el)return;
  var key=null;try{key=localStorage.getItem("tt-ds-key");}catch(e){}
  if(!key){el.style.display="none";return;}
  fetch("https://api.deepseek.com/user/balance",{headers:{"Authorization":"Bearer "+key}}).then(function(r){return r.json();}).then(function(d){
    if(d.balance_infos&&d.balance_infos.length){
      var b=d.balance_infos[0];
      var total=parseFloat(b.total_balance);
      if(total<=0){el.style.display="none";return;}
      var color=total>50?"#22C55E":(total>20?"#EAB308":"#EF4444");
      el.style.display="";
      el.innerHTML='<span class="bal-dot" style="background:'+color+'"></span> DeepSeek <span class="bal-amt">¥'+total.toFixed(2)+'</span>';
    }else{el.style.display="none";}
  }).catch(function(){var e=$("bal");if(e)e.style.display="none";});
}

// ── 事件绑定 ──
$("rf").onclick = refresh;
(function(){
  var btn=$("st-btn"),panel=$("set-panel"),shade=$("set-shade"),close=$("set-close"),save=$("set-save"),inp=$("set-ds-key");
  function getProvidersFromData(){
    var seen={},list=[];
    if(_allProviders){for(var i=0;i<_allProviders.length;i++){var p=_allProviders[i].provider;if(!seen[p]){seen[p]=true;list.push(p);}}}
    return list;
  }
  function openSet(){
    var key=null;try{key=localStorage.getItem("tt-ds-key");}catch(e){}
    if(inp)inp.value=key||"";
    // 供应商显示名
    try{_provNames=JSON.parse(localStorage.getItem("tt-prov-names")||"{}");}catch(e){_provNames={};}
    var plist=getProvidersFromData();
    var html="";
    if(plist.length){
      for(var i=0;i<plist.length;i++){
        var p=plist[i];
        html+='<div class="set-prov-row"><span class="set-prov-orig">'+p+'</span><input class="set-prov-inp" data-prov="'+p+'" placeholder="'+p+'" value="'+(escHTML(_provNames[p]||""))+'"></div>';
      }
    } else {
      html='<div style="font-size:12px;color:var(--text-muted)">加载数据后可见供应商列表</div>';
    }
    var el=$("set-prov-names");if(el)el.innerHTML=html;
    if(shade)shade.style.display="";
    if(panel)panel.style.display="";
  }
  function closeSet(){
    if(shade)shade.style.display="none";
    if(panel)panel.style.display="none";
  }
  function saveSettings(){
    try{localStorage.setItem("tt-ds-key",(inp?inp.value:"").trim());}catch(e){}
    // 保存供应商显示名
    var mapping={};
    var els=document.querySelectorAll(".set-prov-inp");
    for(var i=0;i<els.length;i++){
      var v=(els[i].value||"").trim();
      if(v)mapping[els[i].dataset.prov]=v;
    }
    try{localStorage.setItem("tt-prov-names",JSON.stringify(mapping));}catch(e){}
    _provNames=mapping;
    closeSet();fetchBalance();
    render();
  }
  if(btn)btn.onclick=openSet;
  if(close)close.onclick=closeSet;
  if(save)save.onclick=saveSettings;
  if(shade)shade.onclick=closeSet;
})();
document.querySelectorAll(".fb").forEach(b => {
  b.onclick = function() { R = this.dataset.r; document.querySelectorAll(".fb").forEach(x => x.classList.toggle("act", x.dataset.r === R)); _selAgent=""; _selModel=""; _selProvider=""; syncDateInputs(); load(); };
});

// 自定义下拉选择
(function(){
  function sel(n,id,name){
    if(name==="st"){
      var theme=id||"dark";document.body.setAttribute("data-theme",theme);
      try{localStorage.setItem("token-tracker-theme",theme)}catch(e){}
      if(D)render();return;
    }
    if(name==="stype"){
      _selType=id;
      var tx=$("stype")?.querySelector(".cs-txt");
      if(tx){if(id==="")tx.textContent="会话类型";else tx.textContent=id==="desktop"?"聊天":"频道";}
      load();return;
    }
    if(name==="sp"){
      _selProvider=id;
      _selModel="";
      load();return;
    }
    var e=$("cs-"+name+"-txt");if(e)e.textContent=n;
    _selAgent=name==="sa"?id:_selAgent;
    _selModel=name==="sm"?id:_selModel;
    load();
  }
  document.addEventListener("click",function(e){
    var cs=e.target.closest(".cs");
    document.querySelectorAll(".cs.open").forEach(function(c){if(c!==cs)c.classList.remove("open")});
    if(!cs)return;
    e.stopPropagation();
    cs.classList.toggle("open");
    var opt=e.target.closest(".cs-opt");
    if(opt){
      cs.classList.remove("open");
      var v=opt.dataset.v||"",t=opt.textContent;
      cs.querySelector(".cs-txt").textContent=t;
      sel(t,v,cs.id);
    }
  });
})();

// 日历面板
(function(){
  var cal=document.createElement("div");
  cal.className="cal";
  document.body.appendChild(cal);
  var curInp=null, curY=0, curM=0;
  var today=new Date();
  var tY=today.getFullYear(),tM=today.getMonth(),tD=today.getDate();

  function build(y,m){
    var d=new Date(y,m,1);
    var start=d.getDay();
    var days=new Date(y,m+1,0).getDate();
    var h='<div class="cal-hd"><button data-a="prev">◀</button><span>'+y+'年'+(m+1)+'月</span><button data-a="next">▶</button></div>';
    h+='<div class="cal-grid"><div class="wk">日</div><div class="wk">一</div><div class="wk">二</div><div class="wk">三</div><div class="wk">四</div><div class="wk">五</div><div class="wk">六</div>';
    for(var i=0;i<start;i++) h+='<div class="dim"></div>';
    for(var d=1;d<=days;d++){
      var cls=(y===tY&&m===tM&&d===tD)?' class="today"':'';
      h+='<div'+cls+' data-d="'+d+'">'+d+'</div>';
    }
    h+='</div>';
    cal.innerHTML=h;
    cal.querySelector('[data-a=prev]').onclick=function(e){e.stopPropagation();curM--;if(curM<0){curM=11;curY--;}build(curY,curM);};
    cal.querySelector('[data-a=next]').onclick=function(e){e.stopPropagation();curM++;if(curM>11){curM=0;curY++;}build(curY,curM);};
    cal.querySelectorAll('[data-d]').forEach(function(el){
      el.onclick=function(e){
        e.stopPropagation();
        var dd=String(this.dataset.d).padStart(2,'0');
        var mm=String(curM+1).padStart(2,'0');
        curInp.value=curY+'-'+mm+'-'+dd;
        var df=$("df"),dt=$("dt");
        if(df&&dt&&df.value&&dt.value){
          if(df.value>dt.value){var t=df.value;df.value=dt.value;dt.value=t;}
          cal.classList.remove('on');curInp=null;
          document.querySelectorAll(".fb").forEach(function(x){x.classList.toggle("act",false)});
          R=""; load();
          return;
        }
        cal.classList.remove('on');
        curInp=null;
      };
    });
  }

  function show(inp){
    curInp=inp;
    var v=inp.value||'';
    var p=v.match(/^(\d{4})-(\d{2})/);
    curY=p?parseInt(p[1]):tY; curM=p?parseInt(p[2])-1:tM;
    build(curY,curM);
    var r=inp.getBoundingClientRect();
    cal.style.top=(r.bottom+4)+'px';
    cal.style.left=r.left+'px';
    cal.classList.add('on');
  }

  document.addEventListener('click',function(e){
    if(cal.classList.contains('on')&&!cal.contains(e.target)&&e.target!==curInp) cal.classList.remove('on');
  });

  setTimeout(function(){
    var df=$("df"),dt=$("dt");
    if(df)df.addEventListener("click",function(e){e.stopPropagation();show(this);});
    if(dt)dt.addEventListener("click",function(e){e.stopPropagation();show(this);});
  },200);
})();

// 对话点击 + 余额设置
(function(){document.addEventListener("click",function(e){
  var it=e.target.closest(".cv-it");if(it){_showCv(parseInt(it.dataset.cv));}
  var mb=e.target.closest(".modal-bg");if(mb){var m=$("modal");if(m)m.style.display="none";}
});})();

initTheme();
load(true);
})();
