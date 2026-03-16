
(function(){
  const KEY_EVENTS = 'glp_usage_events';
  const KEY_INSTALL = 'glp_install_meta';
  const KEY_SESSION = 'glp_session_id';
  const KEY_ONBOARD = 'glp_onboarding';
  const MAX_EVENTS = 4000;

  function safeParse(v, fallback){
    try { return JSON.parse(v); } catch { return fallback; }
  }
  function todayISO(){ return new Date().toISOString(); }
  function pageName(){
    const p = location.pathname.split('/').pop() || 'index.html';
    return p;
  }
  function getSession(){
    let s = sessionStorage.getItem(KEY_SESSION);
    if(!s){ s = 'sess_' + Math.random().toString(36).slice(2,10); sessionStorage.setItem(KEY_SESSION, s); }
    return s;
  }
  function ensureInstall(){
    const meta = safeParse(localStorage.getItem(KEY_INSTALL), null) || {
      installedAt: todayISO(),
      firstPage: pageName(),
      installId: 'install_' + Math.random().toString(36).slice(2,10)
    };
    localStorage.setItem(KEY_INSTALL, JSON.stringify(meta));
    return meta;
  }
  function getEvents(){ return safeParse(localStorage.getItem(KEY_EVENTS), []); }
  function saveEvents(arr){ localStorage.setItem(KEY_EVENTS, JSON.stringify(arr.slice(-MAX_EVENTS))); }
  function track(name, meta){
    const evs = getEvents();
    evs.push({ id:'ev_'+Math.random().toString(36).slice(2,11), name, meta: meta||{}, ts: todayISO(), page: pageName(), sessionId: getSession() });
    saveEvents(evs);
  }
  function summarize(){
    const events = getEvents();
    const byName = {};
    const pageViews = {};
    const days = {};
    events.forEach(ev => {
      byName[ev.name] = (byName[ev.name]||0)+1;
      if(ev.name === 'page_view') pageViews[ev.meta && ev.meta.page || ev.page] = (pageViews[ev.meta && ev.meta.page || ev.page]||0)+1;
      const day = (ev.ts||'').slice(0,10);
      if(day) days[day] = (days[day]||0)+1;
    });
    return {
      install: ensureInstall(),
      totalEvents: events.length,
      byEvent: byName,
      pageViews,
      activeDays: Object.keys(days).length,
      dateRange: events.length ? { start: events[0].ts, end: events[events.length-1].ts } : null,
      exportGeneratedAt: todayISO()
    };
  }
  function download(name, text, type){
    const blob = new Blob([text], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  function exportUsage(format){
    const events = getEvents();
    if(format === 'json'){
      download('glp-buddy-usage.json', JSON.stringify({summary:summarize(), events}, null, 2), 'application/json');
      track('usage_exported', {format:'json', count:events.length});
      return;
    }
    const rows = [['timestamp','event','page','session_id','meta_json']];
    events.forEach(ev => rows.push([
      ev.ts || '', ev.name || '', ev.page || '', ev.sessionId || '', JSON.stringify(ev.meta || {})
    ]));
    const csv = rows.map(row => row.map(v => {
      const s = String(v).replace(/"/g,'""');
      return /[",\n]/.test(s) ? '"'+s+'"' : s;
    }).join(',')).join('\n');
    download('glp-buddy-usage.csv', csv, 'text/csv');
    track('usage_exported', {format:'csv', count:events.length});
  }
  function restartOnboarding(){
    localStorage.removeItem(KEY_ONBOARD);
    location.href = 'onboarding.html?next=' + encodeURIComponent(pageName());
  }
  function onboardingComplete(){
    const ob = safeParse(localStorage.getItem(KEY_ONBOARD), {});
    return !!(ob && ob.complete);
  }
  function ensureOnboarding(){
    if(pageName() === 'onboarding.html') return;
    if(!onboardingComplete()){
      location.replace('onboarding.html?next=' + encodeURIComponent(pageName()));
    }
  }
  function injectFontPatch(){
    if(document.getElementById('glp-font-fix')) return;
    const style = document.createElement('style');
    style.id = 'glp-font-fix';
    style.textContent = `
      button, input, textarea, select, option, .btn, .chip, .bnav-label, .bnav-item, .toggle-opt, .multi-opt, .field-input, .field-select, .photo-type-btn, .g-mode-btn, .g-sub-btn, .filter-btn { font-family:'Satoshi',sans-serif !important; }
      .page-title, .header-name, .hero-status, .card-title, .sum-val, .goal-pct, .meal-n, .day-name, .week-day-title, .glpb-topbar-name { font-family:'Clash Display',sans-serif; }
    `;
    document.head.appendChild(style);
  }
  function boot(page, opts){
    opts = opts || {};
    injectFontPatch();
    ensureInstall();
    if(opts.requireOnboarding !== false) ensureOnboarding();
    track('page_view', {page});
  }
  window.GLPApp = { boot, track, summarize, exportUsage, restartOnboarding, onboardingComplete };
})();
