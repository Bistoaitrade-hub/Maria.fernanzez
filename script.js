// script.js -- real-time chart (Binance WS + CoinGecko fallback) + trade ticker + UI tweaks
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // footer year
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // animate trust counters (active users set to 4998)
  $$('.stat-number').forEach(el => {
    const target = parseFloat(el.getAttribute('data-target')) || 0;
    animateCounter(el, target, 1000, target % 1 !== 0);
  });
  function animateCounter(el, to, duration=1000, isFloat=false){
    const start = 0, t0 = performance.now();
    (function frame(now){
      const t = Math.min(1,(now - t0)/duration);
      const v = start + (to - start)*(1 - Math.pow(1 - t, 3));
      el.textContent = isFloat ? v.toFixed(2) : Math.round(v).toLocaleString();
      if (t < 1) requestAnimationFrame(frame);
    })(performance.now());
  }

  // trade ticker DOM
  const tickerTrack = $('#ticker-track');
  let tickerItems = [];
  let tickerOffset = 0;
  let tickerSpeed = 0.4; // px per ms

  // canvas chart
  const canvas = document.getElementById('realtime-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let DPR = window.devicePixelRatio || 1;
  let width=0,height=0;
  function resizeCanvas(){
    width = Math.floor(canvas.clientWidth);
    height = Math.floor(canvas.clientHeight);
    canvas.width = Math.floor(width * DPR);
    canvas.height = Math.floor(height * DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const MAX_POINTS = 120;
  let priceBuffer = [], normBuffer = [];
  let BINANCE_THROTTLE_MS = 600, lastPush = 0;
  let ws=null, wsConnected=false, pollingFallback=false, pollingTimer=null;

  // seed synthetic until we fetch
  seedSynthetic();

  // start draw loop
  let lastDraw = performance.now();
  (function draw(now){
    drawChart();
    drawTicker(now);
    requestAnimationFrame(draw);
  })(performance.now());

  // Try to seed from CoinGecko and open Binance WS
  (async function init(){
    try {
      const hist = await fetchCoinGeckoHistorical('bitcoin',1,'minute');
      if (hist && hist.length) seedBuffers(hist.map(p=>p.p));
    } catch(e){}
    // open WS
    try { connectBinance('btcusdt'); } catch(e){ startCoinGeckoPolling(); }
  })();

  // fetch historical prices
  async function fetchCoinGeckoHistorical(id='bitcoin',days=1,interval='minute'){
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('cg failed');
    const json = await res.json();
    return (json.prices||[]).map(p=>({t:p[0],p:p[1]}));
  }

  function seedBuffers(prices){
    // prices: array of numbers
    if (!prices || !prices.length) return;
    const n = prices.length;
    const step = Math.max(1, Math.floor(n / MAX_POINTS));
    const selected = [];
    for (let i = Math.max(0, n - MAX_POINTS*step); i < n; i += step) selected.push(prices[i]||prices[n-1]);
    while (selected.length < MAX_POINTS) selected.unshift(selected[0]||1);
    priceBuffer = selected.slice(-MAX_POINTS);
    recomputeNorm();
  }

  function seedSynthetic(){
    const base = 40000 + (Math.random()-0.5)*1000;
    priceBuffer = [];
    for (let i=0;i<MAX_POINTS;i++) priceBuffer.push(base + Math.sin(i/6)*400 + (Math.random()-0.5)*200);
    recomputeNorm();
  }

  function recomputeNorm(){
    const minP = Math.min(...priceBuffer), maxP = Math.max(...priceBuffer);
    const range = (maxP-minP) || (minP*0.01) || 1;
    normBuffer = priceBuffer.map(v => clamp01((v-minP)/range));
  }

  // drawing the chart
  function drawChart(){
    // clear
    ctx.clearRect(0,0,width,height);
    // background rounded box
    drawRounded(0,0,width,height,8,'rgba(6,18,38,0.6)');
    const pad=8, innerW=width-pad*2, innerH=height-pad*2;
    const pts = normBuffer.slice(-MAX_POINTS);
    const n = pts.length; if (n<2) return;
    const step = innerW/(MAX_POINTS-1);
    // area
    ctx.beginPath();
    for (let i=0;i<n;i++){
      const x = pad + i*step;
      const y = pad + (1-pts[i])*innerH;
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.lineTo(pad + (n-1)*step, pad + innerH);
    ctx.lineTo(pad, pad + innerH);
    ctx.closePath();
    const g = ctx.createLinearGradient(0,pad,0,pad+innerH);
    g.addColorStop(0,'rgba(0,82,255,0.18)'); g.addColorStop(1,'rgba(0,82,255,0.02)');
    ctx.fillStyle = g; ctx.fill();
    // line
    ctx.beginPath();
    for (let i=0;i<n;i++){
      const x = pad + i*step; const y = pad + (1-pts[i])*innerH;
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.lineWidth = 2.8; ctx.strokeStyle = '#74A6FF'; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();
    // dot
    const lx = pad + (n-1)*step, ly = pad + (1-pts[n-1])*innerH;
    ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(lx,ly,4,0,Math.PI*2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#0052FF'; ctx.stroke();
  }

  function drawRounded(x,y,w,h,r,fill){
    ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  }

  // BINANCE WEBSOCKET
  function connectBinance(symbol='btcusdt'){
    const url = `wss://stream.binance.com:9443/ws/${symbol}@trade`;
    ws = new WebSocket(url);
    ws.addEventListener('open', ()=>{ console.log('WS open'); wsConnected=true; pollingFallback=false; });
    ws.addEventListener('message', evt => {
      try{
        const data = JSON.parse(evt.data);
        const price = parseFloat(data.p || data.price || 0);
        if (price && Date.now()-lastPush>BINANCE_THROTTLE_MS){ pushPrice(price); lastPush = Date.now(); addTickerTrade(price); }
      }catch(e){}
    });
    ws.addEventListener('error', ()=> fallbackToPolling());
    ws.addEventListener('close', ()=> fallbackToPolling());
    window.addEventListener('beforeunload', ()=>{ if (ws && ws.readyState===WebSocket.OPEN) ws.close(); });
  }

  function pushPrice(price){
    priceBuffer.push(price);
    if (priceBuffer.length>MAX_POINTS) priceBuffer.shift();
    recomputeNorm();
  }

  function fallbackToPolling(){
    if (pollingFallback) return;
    pollingFallback=true;
    if (ws && ws.readyState===WebSocket.OPEN) try{ ws.close(); }catch(e){}
    startPolling();
  }

  async function startPolling(){
    await fetchAndPush();
    pollingTimer = setInterval(fetchAndPush,10000);
  }
  async function fetchAndPush(){
    try{
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      if (!res.ok) return;
      const js = await res.json();
      const p = js.bitcoin && js.bitcoin.usd;
      if (p) { pushPrice(parseFloat(p)); addTickerTrade(p); }
    }catch(e){}
  }

  // TRADE TICKER: manage small list and animate translateX
  const tickerContainer = tickerTrack;
  function addTickerTrade(price){
    const color = (Math.random()>0.5) ? 'green' : 'red';
    const item = document.createElement('div');
    item.className = 'tick-item';
    item.textContent = `BTC ${price.toLocaleString(undefined,{maximumFractionDigits:0})} ${color==='green'?'+':'-'}${(Math.random()*2).toFixed(2)}%`;
    item.style.paddingRight = '12px';
    tickerItems.push(item);
    tickerContainer.appendChild(item);
    // limit number of elements to avoid memory growth
    if (tickerItems.length > 60){
      const rem = tickerItems.shift();
      if (rem && rem.parentNode) rem.parentNode.removeChild(rem);
    }
  }

  // Ticker animation using transform offset
  let lastTick = performance.now();
  function drawTicker(now){
    const dt = now - lastTick;
    lastTick = now;
    // ensure track width, if small, duplicate items to create continuous scroll
    const trackW = tickerContainer.scrollWidth;
    if (trackW < (tickerContainer.clientWidth * 1.5)){
      // clone existing items
      const clones = tickerItems.map(i => i.cloneNode(true));
      clones.forEach(c=>tickerContainer.appendChild(c));
      tickerItems = tickerItems.concat(clones);
    }
    tickerOffset -= tickerSpeed * dt;
    // reset when fully scrolled
    const resetAt = - (tickerContainer.scrollWidth / 2);
    if (tickerOffset < resetAt) tickerOffset = 0;
    tickerContainer.style.transform = `translateX(${tickerOffset}px)`;
  }

  // expose feeding hook
  window.BistoAI_Chart = {
    pushRawPrice: p => { if (typeof p==='number' && p>0) pushPrice(p); },
    pushNormalized: n => { const v = clamp01(n); normBuffer.push(v); if (normBuffer.length>MAX_POINTS) normBuffer.shift(); },
    stop: ()=>{ if (pollingTimer) clearInterval(pollingTimer); if (ws) ws.close(); },
    start: ()=>{ if (!wsConnected) connectBinance('btcusdt'); if (pollingFallback) startPolling(); }
  };

  // begin with a couple of fake ticks to populate ticker
  setTimeout(()=>{ for(let i=0;i<6;i++) addTickerTrade( (40000 + Math.random()*2000) ); },300);

  // UI small entrance animations
  document.querySelectorAll('.animated').forEach((el,idx)=>{
    el.style.opacity=0; el.style.transform='translateY(8px)';
    setTimeout(()=>{ el.style.transition='transform .6s cubic-bezier(.2,.9,.2,1), opacity .6s ease'; el.style.transform='translateY(0)'; el.style.opacity=1; }, 120+idx*80);
  });

  // smooth anchors
  document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{
    const href=a.getAttribute('href'); const target=document.querySelector(href);
    if (target){ e.preventDefault(); target.scrollIntoView({behavior:'smooth',block:'start'}); target.setAttribute('tabindex','-1'); target.focus({preventScroll:true}); setTimeout(()=>target.removeAttribute('tabindex'),800); }
  }));

})();