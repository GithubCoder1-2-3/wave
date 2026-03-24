import { useState, useEffect, useRef, useCallback, memo } from "react";

/* ─── API HELPERS ───────────────────────────────────────────────── */
const CORS = "https://cors-proxy.iammrbeastbackup.workers.dev/?url=";
const DEEZER = "https://api.deezer.com";
const YT_KEY = "AIzaSyAsh-f3HYGwjVf93YDlNkliBb_bBukn-uY";

const dz = async (path) => {
  try {
    const r = await fetch(`${CORS}${encodeURIComponent(DEEZER + path)}`);
    return r.json();
  } catch { return {}; }
};
const ytSearch = async (q) => {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&key=${YT_KEY}&maxResults=1`);
  const d = await r.json();
  return d.items?.[0]?.id?.videoId || null;
};

/* ─── WOLF API (Tidal streams via wolf.qqdl.site) ──────────────── */
const WOLF = "https://wolf.qqdl.site";
const wolfSearch = async (q) => {
  try {
    const r = await fetch(`${CORS}${encodeURIComponent(`${WOLF}/search?s=${encodeURIComponent(q)}`)}`);
    const j = await r.json();
    return (j?.data?.items || j?.items || [])[0]?.id || null;
  } catch { return null; }
};
const wolfStream = async (id) => {
  try {
    const r = await fetch(`${CORS}${encodeURIComponent(`${WOLF}/track/?id=${id}`)}`);
    const j = await r.json();
    const manifest = j?.data?.manifest;
    if (!manifest) return null;
    const decoded = atob(manifest);
    // DASH MPD → blob URL
    if (decoded.includes("<MPD") || decoded.includes("<?xml")) {
      const blob = new Blob([decoded], { type: "application/dash+xml" });
      return { type: "dash", url: URL.createObjectURL(blob) };
    }
    // JSON with direct URL array
    try {
      const p = JSON.parse(decoded);
      if (p?.urls?.[0]) return { type: "direct", url: p.urls[0] };
    } catch {}
    // Plain URL
    const m = decoded.match(/https?:\/\/[^\s"'<>]+/);
    if (m) return { type: "direct", url: m[0] };
    return null;
  } catch { return null; }
};
const fmt = (s) => { if (!s && s !== 0) return "0:00"; return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`; };
const fmtBig = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n || 0);

/* ─── SUPABASE CLIENT ───────────────────────────────────────────── */
const SB_URL = "https://tmrdnlyrpdjhpcslijgf.supabase.co";
const SB_KEY = "sb_publishable_1encqH4sq_MRn0qu3vfe2A_EnJ6vt6A";

/* Auth token stored in localStorage */
const getToken = () => { try { return localStorage.getItem("wave_sb_token") || null; } catch { return null; } };
const setToken = (t) => { try { if (t) localStorage.setItem("wave_sb_token", t); else localStorage.removeItem("wave_sb_token"); } catch {} };
const getUserId = () => { try { const t = getToken(); if (!t) return null; return JSON.parse(atob(t.split(".")[1]))?.sub || null; } catch { return null; } };

const sbFetch = async (path, opts = {}) => {
  const token = getToken() || SB_KEY;
  const r = await fetch(`${SB_URL}/rest/v1${path}`, {
    ...opts,
    headers: { "apikey": SB_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Prefer": "return=representation", ...(opts.headers || {}) },
  });
  if (!r.ok) return null;
  return r.json().catch(() => null);
};

/* Auth API */
const sbSignUp = async (email, password) => {
  const r = await fetch(`${SB_URL}/auth/v1/signup`, { method: "POST", headers: { "apikey": SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return r.json();
};
const sbSignIn = async (email, password) => {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "apikey": SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return r.json();
};
const sbMagicLink = async (email) => {
  const r = await fetch(`${SB_URL}/auth/v1/magiclink`, { method: "POST", headers: { "apikey": SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  return r.json();
};
const sbSignOut = async () => {
  const token = getToken();
  if (token) await fetch(`${SB_URL}/auth/v1/logout`, { method: "POST", headers: { "apikey": SB_KEY, "Authorization": `Bearer ${token}` } });
  setToken(null);
};

/* ── YouTube URL Cache ── */
const ytCacheGet = async (trackId) => {
  const d = await sbFetch(`/yt_cache?track_id=eq.${trackId}&select=video_id&limit=1`);
  return d?.[0]?.video_id || null;
};
const ytCacheSet = async (trackId, artist, title, videoId) => {
  await sbFetch("/yt_cache", { method: "POST", body: JSON.stringify({ track_id: trackId, artist, title, video_id: videoId }) });
};

/* ── Custom Playlists ── */
const plGet = async () => {
  const uid = getUserId();
  if (uid) {
    const own = await sbFetch(`/user_playlists?select=*,playlist_tracks(count)&order=created_at.desc`) || [];
    return Array.isArray(own) ? own : [];
  }
  const pub = await sbFetch(`/user_playlists?select=*,playlist_tracks(count)&is_public=eq.true&order=created_at.desc`) || [];
  return Array.isArray(pub) ? pub : [];
};
const plGetPublic = async () => {
  const d = await sbFetch(`/user_playlists?select=*,playlist_tracks(count)&is_public=eq.true&order=created_at.desc`) || [];
  return Array.isArray(d) ? d : [];
};
const plCreate = async (name, isPublic = false) => {
  const uid = getUserId();
  return sbFetch("/user_playlists", { method: "POST", body: JSON.stringify({ name, is_public: isPublic, user_id: uid }) });
};
const plDelete = async (id) => { await sbFetch(`/user_playlists?id=eq.${id}`, { method: "DELETE" }); await sbFetch(`/playlist_tracks?playlist_id=eq.${id}`, { method: "DELETE" }); };
const plAddTrack = async (playlistId, track) => {
  await sbFetch("/playlist_tracks", { method: "POST", body: JSON.stringify({ playlist_id: playlistId, track_id: track.id, track_data: track }) });
  // Set cover from first track if not already set
  const cover = track.album?.cover_medium || track.album?.cover_small || null;
  if (cover) await sbFetch(`/user_playlists?id=eq.${playlistId}`, { method: "PATCH", body: JSON.stringify({ cover_url: cover }) });
};
const plRemoveTrack = async (playlistId, trackId) => sbFetch(`/playlist_tracks?playlist_id=eq.${playlistId}&track_id=eq.${trackId}`, { method: "DELETE" });
const plGetTracks = async (playlistId) => { const d = await sbFetch(`/playlist_tracks?playlist_id=eq.${playlistId}&select=track_data&order=created_at.asc`); return (d || []).map(r => r.track_data); };

/* ── Similar Tracks Cache ── */
const similarGet = async (trackId) => { const d = await sbFetch(`/similar_cache?track_id=eq.${trackId}&select=tracks&limit=1`); return d?.[0]?.tracks || null; };
const similarSet = async (trackId, tracks) => sbFetch("/similar_cache", { method: "POST", body: JSON.stringify({ track_id: trackId, tracks }) });

/* ── User Data (liked, recent, prefs) ── */
const userDataGet = async () => { const d = await sbFetch(`/user_data?user_id=eq.${getUserId()}&limit=1`); return d?.[0] || null; };
const userDataSave = async (payload) => {
  const uid = getUserId(); if (!uid) return;
  await sbFetch("/user_data", { method: "POST", headers: { "Prefer": "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ user_id: uid, ...payload, updated_at: new Date().toISOString() }) });
};

/* ── Google user info from token ── */
const getGoogleProfile = () => {
  try {
    const t = getToken(); if (!t) return null;
    const p = JSON.parse(atob(t.split(".")[1]));
    return { name: p.user_metadata?.full_name || p.user_metadata?.name || p.email?.split("@")[0] || "me", avatar: p.user_metadata?.avatar_url || p.user_metadata?.picture || null, email: p.email || "" };
  } catch { return null; }
};

/* ─── LOCALSTORAGE PERSISTENCE ────────────────────────────────── */
const LS_PREFIX = "wave_";
const lsGet = (key, fallback) => { try { const v = localStorage.getItem(LS_PREFIX + key); return v !== null ? JSON.parse(v) : fallback; } catch { return fallback; } };
const lsSet = (key, val) => { try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); } catch {} };

/* ─── YT PLAYER BOOTSTRAP ──────────────────────────────────────── */
let _ytLoaded = false, _ytReady = false;
const _ytCbs = [];
function ensureYT() {
  if (_ytLoaded) return; _ytLoaded = true;
  window.onYouTubeIframeAPIReady = () => { _ytReady = true; _ytCbs.forEach(c => c()); _ytCbs.length = 0; };
  const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s);
}
function whenYT(cb) { if (_ytReady && window.YT?.Player) cb(); else _ytCbs.push(cb); }

/* ─── THEME CSS ─────────────────────────────────────────────────── */
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@100;200;300;400;500;600;700;800;900&family=Geist+Mono:wght@300;400;500;600;700&display=swap');

*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg:       #ffffff;
  --bg2:      #fafafa;
  --bg3:      #f4f4f5;
  --surface:  #ffffff;
  --border:   #e4e4e7;
  --border2:  #d4d4d8;
  --tx:       #09090b;
  --tx2:      #52525b;
  --tx3:      #a1a1aa;
  --tx4:      #d4d4d8;
  --accent:   #0070f3;
  --accent-h: #0060df;
  --red:      #e5484d;
  --green:    #30a46c;
  --green-bg: rgba(48,164,108,.1);
  --yellow:   #f5a623;
  --line:     1px solid var(--border);
  --shadow:   0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
  --shadow-lg:0 4px 16px rgba(0,0,0,.08);
  --r:        6px;
  --r2:       4px;
  --trans:    background .15s, color .15s, border-color .15s;
}
[data-theme="dark"] {
  --bg:       #09090b;
  --bg2:      #111113;
  --bg3:      #18181b;
  --surface:  #09090b;
  --border:   #27272a;
  --border2:  #3f3f46;
  --tx:       #fafafa;
  --tx2:      #a1a1aa;
  --tx3:      #52525b;
  --tx4:      #27272a;
  --accent:   #3b82f6;
  --accent-h: #2563eb;
  --shadow:   0 1px 3px rgba(0,0,0,.4);
  --shadow-lg:0 4px 16px rgba(0,0,0,.5);
}

html, body { height: 100%; font-family: 'Geist', sans-serif; background: var(--bg); color: var(--tx); -webkit-font-smoothing: antialiased; overflow: hidden; }
* { transition: var(--trans); }
button, input, select { transition: var(--trans); }
/* ── scrollbar ── */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
.shell { display: grid; grid-template-columns: var(--nav-w, 220px) 1fr; grid-template-rows: 1fr 82px 0px; height: 100vh; height: 100dvh; transition: grid-template-columns .2s cubic-bezier(.4,0,.2,1); }

::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

.shell.nav-collapsed { --nav-w: 0px; }

.nav { grid-row: 1/2; background: var(--bg); border-right: var(--line); display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
.nav-inner { width: 220px; display: flex; flex-direction: column; height: 100%; overflow-y: auto; }
.nav-header { padding: 0 14px; height: 48px; display: flex; align-items: center; gap: 9px; border-bottom: var(--line); flex-shrink: 0; }
.logo { display: flex; align-items: center; gap: 8px; text-decoration: none; }
.logo-mark { display: flex; align-items: center; gap: 1px; }
.logo-mark span { display: block; border-radius: 1.5px; background: var(--tx); transition: background .15s; }
.logo-word { font-size: 14px; font-weight: 700; letter-spacing: -.02em; color: var(--tx); white-space: nowrap; }
.nav-body { flex: 1; overflow-y: auto; padding: 6px 0; }
.nav-section { margin-bottom: 2px; }
.nav-section-label { font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--tx3); padding: 8px 16px 3px; font-family: 'Geist Mono', monospace; }
.nav-item { display: flex; align-items: center; gap: 9px; padding: 6px 14px; font-size: 13px; font-weight: 400; color: var(--tx2); cursor: pointer; border-left: 2px solid transparent; transition: all .1s; user-select: none; white-space: nowrap; }
.nav-item:hover { color: var(--tx); background: var(--bg3); }
.nav-item.active { color: var(--tx); border-left-color: var(--tx); background: var(--bg3); font-weight: 500; }
.nav-item .badge { margin-left: auto; font-family: 'Geist Mono', monospace; font-size: 10px; background: var(--bg3); border: var(--line); padding: 1px 5px; border-radius: 3px; color: var(--tx3); }
.nav-lib-track { display: flex; align-items: center; gap: 8px; padding: 5px 14px; font-size: 12px; color: var(--tx2); cursor: pointer; transition: all .1s; overflow: hidden; }
.nav-lib-track:hover { color: var(--tx); background: var(--bg3); }
.nav-lib-track img { width: 24px; height: 24px; border-radius: 3px; object-fit: cover; flex-shrink: 0; border: var(--line); }
.nav-lib-track span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-now-playing { margin: 6px 10px; border: var(--line); border-radius: var(--r); padding: 10px; background: var(--bg2); flex-shrink: 0; }
.nav-now-label { font-size: 9px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--tx3); font-family: 'Geist Mono', monospace; margin-bottom: 6px; }
.nav-now-info { display: flex; align-items: center; gap: 8px; }
.nav-now-img { width: 32px; height: 32px; border-radius: 3px; object-fit: cover; border: var(--line); flex-shrink: 0; }
.nav-now-title { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-now-artist { font-size: 11px; color: var(--tx3); font-family: 'Geist Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.topbar { position: sticky; top: 0; z-index: 30; height: 48px; background: rgba(var(--bg-rgb, 255,255,255), .88); backdrop-filter: blur(12px) saturate(180%); border-bottom: var(--line); display: flex; align-items: center; padding: 0 16px; gap: 10px; }
[data-theme="dark"] .topbar { background: rgba(9,9,11,.88); }
.topbar-left { display: flex; align-items: center; gap: 8px; }
.icon-btn { background: none; border: var(--line); border-radius: var(--r2); width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--tx2); transition: all .1s; }
.icon-btn:hover { color: var(--tx); background: var(--bg3); }
.icon-btn.active { color: var(--accent); border-color: var(--accent); background: rgba(0,112,243,.06); }
.srch-form { flex: 1; max-width: 380px; position: relative; }
.srch-in { width: 100%; height: 30px; background: var(--bg3); border: var(--line); border-radius: var(--r); padding: 0 10px 0 32px; font-size: 12px; font-family: 'Geist', sans-serif; color: var(--tx); outline: none; }
.srch-in:focus { background: var(--bg); border-color: var(--border2); box-shadow: 0 0 0 3px rgba(0,112,243,.12); }
.srch-in::placeholder { color: var(--tx3); }
.srch-ic { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--tx3); pointer-events: none; }
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.chip { font-family: 'Geist Mono', monospace; font-size: 10px; font-weight: 500; padding: 2px 6px; border-radius: 3px; border: var(--line); color: var(--tx3); letter-spacing: .04em; white-space: nowrap; }
.chip.live { border-color: var(--green); color: var(--green); background: var(--green-bg); }
.chip.warn { border-color: var(--yellow); color: var(--yellow); background: rgba(245,166,35,.08); }

.main { grid-row: 1/2; overflow-y: auto; background: var(--bg); position: relative; }

.ph { padding: 20px 20px 16px; border-bottom: var(--line); }
.pt { font-size: 20px; font-weight: 700; letter-spacing: -.03em; }
.ps { font-size: 11px; color: var(--tx3); margin-top: 3px; font-family: 'Geist Mono', monospace; }
.sec { }
.sec-hd { display: flex; align-items: center; justify-content: space-between; padding: 9px 18px; border-bottom: var(--line); background: var(--bg2); }
.sec-lbl { font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--tx3); font-family: 'Geist Mono', monospace; display: flex; align-items: center; gap: 7px; }
.sec-act { font-size: 11px; color: var(--tx3); cursor: pointer; font-family: 'Geist Mono', monospace; transition: color .1s; }
.sec-act:hover { color: var(--tx); }

.ttbl { width: 100%; border-collapse: collapse; }
.ttbl thead { border-bottom: var(--line); }
.ttbl th { padding: 7px 14px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--tx3); text-align: left; font-family: 'Geist Mono', monospace; white-space: nowrap; }
.ttbl th.r { text-align: right; }
.ttbl tbody tr { border-bottom: var(--line); cursor: pointer; }
.ttbl tbody tr:hover { background: var(--bg2); }
.ttbl tbody tr.tr-active { background: var(--bg3); }
.ttbl td { padding: 7px 14px; vertical-align: middle; }
.td-n { width: 36px; font-family: 'Geist Mono', monospace; font-size: 11px; color: var(--tx3); text-align: center; }
.tr-active .td-n { color: var(--accent); }
.td-info { display: flex; align-items: center; gap: 10px; }
.td-art { width: 34px; height: 34px; border-radius: 3px; object-fit: cover; border: var(--line); flex-shrink: 0; }
.td-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; display: flex; align-items: center; gap: 5px; }
.tr-active .td-name { color: var(--accent); }
.td-sub { font-size: 11px; color: var(--tx3); font-family: 'Geist Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-album { font-size: 11px; color: var(--tx3); font-family: 'Geist Mono', monospace; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-dur { font-family: 'Geist Mono', monospace; font-size: 11px; color: var(--tx3); text-align: right; }
.explicit-tag { font-size: 9px; font-weight: 700; letter-spacing: .04em; background: var(--tx3); color: var(--bg); padding: 1px 4px; border-radius: 2px; flex-shrink: 0; font-family: 'Geist Mono', monospace; }
.like-btn { background: none; border: none; cursor: pointer; color: var(--tx3); padding: 3px; display: flex; }
.like-btn:hover { color: var(--tx); }
.like-btn.liked { color: var(--red); }

.cgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); border-left: var(--line); }
.cgrid > * { border-right: var(--line); border-bottom: var(--line); }
.gc { padding: 14px; cursor: pointer; position: relative; overflow: hidden; }
.gc:hover { background: var(--bg2); }
.gc-img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--r2); margin-bottom: 10px; border: var(--line); display: block; }
.gc-img.round { border-radius: 50%; }
.gc-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gc-sub { font-size: 11px; color: var(--tx3); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: 'Geist Mono', monospace; }
.gc-play { position: absolute; bottom: 12px; right: 12px; width: 28px; height: 28px; background: var(--tx); border-radius: var(--r2); display: flex; align-items: center; justify-content: center; opacity: 0; transform: scale(.8) translateY(4px); transition: all .15s; }
.gc:hover .gc-play { opacity: 1; transform: scale(1) translateY(0); }

.ggrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); border-left: var(--line); }
.ggrid > * { border-right: var(--line); border-bottom: var(--line); }
.gcel { padding: 18px 14px; cursor: pointer; position: relative; overflow: hidden; min-height: 76px; }
.gcel:hover { background: var(--bg2); }
.gcel-name { font-size: 13px; font-weight: 600; position: relative; z-index: 1; }
.gcel-img { position: absolute; right: -6px; bottom: -6px; width: 54px; height: 54px; border-radius: 3px; object-fit: cover; opacity: .4; transform: rotate(12deg); }
.gcel::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: var(--tx); transform: scaleX(0); transform-origin: left; transition: transform .2s; }
.gcel:hover::after { transform: scaleX(1); }

.ehero { display: grid; grid-template-columns: 160px 1fr; border-bottom: var(--line); }
.ehero-img-cell { border-right: var(--line); background: var(--bg2); display: flex; align-items: center; justify-content: center; padding: 20px; }
.ehero-img { width: 120px; height: 120px; border-radius: var(--r2); object-fit: cover; border: var(--line); }
.ehero-img.round { border-radius: 50%; }
.ehero-info { padding: 20px; display: flex; flex-direction: column; justify-content: flex-end; gap: 5px; }
.entity-type { font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--tx3); font-family: 'Geist Mono', monospace; }
.entity-name { font-size: 24px; font-weight: 700; letter-spacing: -.03em; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entity-meta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 2px; }
.emeta-item { font-size: 11px; color: var(--tx3); font-family: 'Geist Mono', monospace; }
.emeta-item .lbl { color: var(--tx4); margin-right: 3px; }
.play-hero-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--tx); color: var(--bg); border: none; border-radius: var(--r2); padding: 7px 14px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'Geist', sans-serif; margin-top: 8px; }
.play-hero-btn:hover { opacity: .85; }

.player { grid-column: 1/3; background: var(--surface); border-top: 2px solid var(--tx); display: grid; grid-template-columns: 260px 1fr 220px; align-items: stretch; position: relative; }
.pl-track { border-right: var(--line); display: flex; align-items: center; gap: 10px; padding: 0 14px; overflow: hidden; }
.pl-thumb { width: 44px; height: 44px; border-radius: 3px; object-fit: cover; border: var(--line); flex-shrink: 0; }
.pl-meta { overflow: hidden; flex: 1; }
.pl-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -.01em; }
.pl-artist { font-size: 11px; color: var(--tx3); font-family: 'Geist Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-center { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 0 14px; }
.pl-btns { display: flex; align-items: center; gap: 12px; }
.ctrl-btn { background: none; border: none; cursor: pointer; color: var(--tx3); display: flex; align-items: center; padding: 4px; border-radius: 3px; transition: all .1s; }
.ctrl-btn:hover { color: var(--tx); background: var(--bg3); }
.ctrl-btn.active { color: var(--tx); }
.play-main-btn { background: var(--tx); border: none; width: 30px; height: 30px; border-radius: var(--r2); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
.play-main-btn:hover { opacity: .8; }
.prog-row { display: flex; align-items: center; gap: 8px; width: 100%; }
.prog-time { font-family: 'Geist Mono', monospace; font-size: 10px; color: var(--tx3); min-width: 28px; }
.prog-rail { flex: 1; height: 3px; background: var(--bg3); cursor: pointer; border-radius: 2px; position: relative; }
.prog-fill { height: 100%; background: var(--tx); border-radius: 2px; pointer-events: none; }
.pl-right { border-left: var(--line); display: flex; align-items: center; gap: 8px; padding: 0 14px; justify-content: flex-end; }
.vol-wrap { display: flex; align-items: center; gap: 6px; }
.vol-range { -webkit-appearance: none; width: 72px; height: 3px; background: var(--bg3); border-radius: 2px; outline: none; cursor: pointer; }
.vol-range::-webkit-slider-thumb { -webkit-appearance: none; width: 10px; height: 10px; background: var(--tx); border-radius: 50%; }

.eq { display: flex; align-items: flex-end; gap: 1.5px; height: 12px; }
.eq-b { width: 2.5px; background: var(--accent); border-radius: 1px; animation: eqa .6s ease-in-out infinite alternate; }
.eq-b:nth-child(2) { animation-delay: .15s; }
.eq-b:nth-child(3) { animation-delay: .3s; }
@keyframes eqa { from { height: 3px; } to { height: 12px; } }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.ld { display: flex; align-items: center; justify-content: center; padding: 80px; gap: 8px; color: var(--tx3); font-size: 12px; font-family: 'Geist Mono', monospace; }

.back-btn { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; color: var(--tx3); cursor: pointer; background: none; border: var(--line); padding: 4px 10px; border-radius: var(--r2); font-family: 'Geist Mono', monospace; transition: all .1s; }
.back-btn:hover { color: var(--tx); background: var(--bg3); border-color: var(--border2); }

.toast-area { position: fixed; bottom: 96px; right: 16px; z-index: 100; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
.toast { background: var(--tx); color: var(--bg); padding: 10px 14px; border-radius: var(--r); font-size: 12px; font-family: 'Geist', sans-serif; box-shadow: var(--shadow-lg); display: flex; align-items: center; gap: 8px; animation: toastIn .2s ease; pointer-events: all; }
@keyframes toastIn { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: none; } }

.queue-overlay { position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.3); }
.queue-panel { position: fixed; top: 0; right: 0; width: 320px; height: calc(100vh - 82px); background: var(--bg); border-left: 2px solid var(--tx); display: flex; flex-direction: column; z-index: 51; animation: slideIn .2s ease; }
@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
.queue-hd { padding: 14px 16px; border-bottom: var(--line); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.queue-title { font-size: 13px; font-weight: 600; }
.queue-body { flex: 1; overflow-y: auto; }
.queue-item { display: flex; align-items: center; gap: 9px; padding: 8px 14px; border-bottom: var(--line); cursor: pointer; transition: background .1s; }
.queue-item:hover { background: var(--bg2); }
.queue-item.current { background: var(--bg3); }
.queue-item img { width: 32px; height: 32px; border-radius: 3px; object-fit: cover; border: var(--line); flex-shrink: 0; }
.queue-item-meta { overflow: hidden; flex: 1; }
.queue-item-name { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue-item-name.active { color: var(--accent); }
.queue-item-sub { font-size: 11px; color: var(--tx3); font-family: 'Geist Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue-num { font-family: 'Geist Mono', monospace; font-size: 10px; color: var(--tx3); width: 18px; text-align: center; flex-shrink: 0; }

.settings-grid { display: grid; grid-template-columns: 1fr 1fr; border-left: var(--line); }
.settings-grid > * { border-right: var(--line); border-bottom: var(--line); }
.setting-card { padding: 20px; }
.setting-card-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.setting-card-desc { font-size: 12px; color: var(--tx3); margin-bottom: 14px; font-family: 'Geist Mono', monospace; line-height: 1.5; }
.toggle-wrap { display: flex; align-items: center; justify-content: space-between; }
.toggle { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; inset: 0; background: var(--bg3); border: var(--line); border-radius: 20px; cursor: pointer; transition: all .2s; }
.toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 2px; top: 2px; background: var(--tx3); border-radius: 50%; transition: all .2s; }
.toggle input:checked + .toggle-slider { background: var(--tx); border-color: var(--tx); }
.toggle input:checked + .toggle-slider::before { transform: translateX(16px); background: var(--bg); }
.kbd-grid { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; align-items: center; }
.kbd { font-family: 'Geist Mono', monospace; font-size: 10px; font-weight: 600; background: var(--bg3); border: var(--line); border-bottom: 2px solid var(--border2); padding: 2px 7px; border-radius: 4px; color: var(--tx2); white-space: nowrap; }
.kbd-desc { font-size: 12px; color: var(--tx3); font-family: 'Geist Mono', monospace; }
.setting-select { width: 100%; padding: 6px 10px; background: var(--bg3); border: var(--line); border-radius: var(--r2); font-size: 12px; font-family: 'Geist Mono', monospace; color: var(--tx); outline: none; cursor: pointer; }
.about-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.about-version { font-family: 'Geist Mono', monospace; font-size: 11px; color: var(--tx3); }
.stat-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.stat-box { background: var(--bg3); border: var(--line); border-radius: var(--r2); padding: 10px; }
.stat-val { font-size: 18px; font-weight: 700; letter-spacing: -.02em; font-family: 'Geist Mono', monospace; }
.stat-key { font-size: 10px; color: var(--tx3); margin-top: 2px; font-family: 'Geist Mono', monospace; text-transform: uppercase; letter-spacing: .06em; }

.recent-strip { display: flex; overflow-x: auto; gap: 0; border-bottom: var(--line); }
.recent-strip::-webkit-scrollbar { height: 0; }
.recent-item { flex-shrink: 0; padding: 12px 14px; border-right: var(--line); cursor: pointer; display: flex; align-items: center; gap: 9px; min-width: 0; max-width: 200px; overflow: hidden; }
.recent-item:hover { background: var(--bg2); }
.recent-item img { width: 36px; height: 36px; border-radius: 3px; object-fit: cover; border: var(--line); flex-shrink: 0; }
.recent-item div { min-width: 0; overflow: hidden; }
.recent-item-name { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-item-sub { font-size: 11px; color: var(--tx3); font-family: 'Geist Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.empty { padding: 60px 20px; text-align: center; border-bottom: var(--line); }
.empty-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.empty-sub { font-size: 12px; color: var(--tx3); font-family: 'Geist Mono', monospace; }

#yt-mount { position: fixed; bottom: -1000px; left: -1000px; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

/* ═══════════════════════════════════════════════════════
   FULLSCREEN MODE
   ═══════════════════════════════════════════════════════ */
.fs-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: #09090b;
  display: grid;
  grid-template-rows: 1fr auto;
  overflow: hidden;
  animation: fsIn .3s cubic-bezier(.4,0,.2,1);
}
@keyframes fsIn { from { opacity: 0; transform: scale(1.015); } to { opacity: 1; transform: none; } }

.fs-bg {
  position: absolute; inset: -40px;
  background-size: cover; background-position: center;
  filter: blur(60px) saturate(1.4);
  opacity: .18;
  pointer-events: none;
  transition: background-image .6s;
}

.fs-main {
  display: grid;
  grid-template-columns: 1fr 0px;
  gap: 0;
  overflow: hidden;
  position: relative;
  transition: grid-template-columns .25s cubic-bezier(.4,0,.2,1);
}
.fs-main.sidebar-open {
  grid-template-columns: 1fr 300px;
}
.fs-sidebar-toggle {
  position: absolute; top: 14px; left: 14px; z-index: 10;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
  border-radius: 4px; width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: rgba(255,255,255,.5); transition: all .1s;
}
.fs-sidebar-toggle:hover { color: #fafafa; background: rgba(255,255,255,.1); }
.fs-sidebar-toggle.open { color: #fafafa; border-color: rgba(255,255,255,.3); }

.fs-left {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 48px;
  border-right: 1px solid rgba(255,255,255,.07);
  position: relative;
  gap: 28px;
}

.fs-art-wrap { position: relative; flex-shrink: 0; }
.fs-art {
  width: clamp(200px, 26vw, 320px);
  height: clamp(200px, 26vw, 320px);
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid rgba(255,255,255,.12);
  display: block;
  transition: transform .4s cubic-bezier(.4,0,.2,1), box-shadow .4s;
}
.fs-art.playing {
  box-shadow: 0 0 0 1px rgba(255,255,255,.15), 0 24px 64px rgba(0,0,0,.6);
  transform: scale(1.02);
}
.fs-art-placeholder {
  width: clamp(200px, 26vw, 320px);
  height: clamp(200px, 26vw, 320px);
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,.1);
  display: flex; align-items: center; justify-content: center;
  background: #18181b;
}

.fs-meta { text-align: center; width: 100%; max-width: 380px; }
.fs-track-title {
  font-size: clamp(16px, 2vw, 24px);
  font-weight: 700; letter-spacing: -.03em; color: #fafafa;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 5px;
}
.fs-track-artist { font-size: 13px; color: rgba(255,255,255,.5); font-family: 'Geist Mono', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fs-track-album { font-size: 11px; color: rgba(255,255,255,.3); font-family: 'Geist Mono', monospace; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.fs-actions { display: flex; align-items: center; gap: 10px; margin-top: 4px; flex-wrap: wrap; justify-content: center; }
.fs-action-btn {
  background: none; border: 1px solid rgba(255,255,255,.12);
  border-radius: 4px; width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: rgba(255,255,255,.5); transition: all .1s;
}
.fs-action-btn:hover { color: #fafafa; background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.25); }
.fs-action-btn.active { color: #fafafa; border-color: rgba(255,255,255,.4); }
.fs-action-btn.liked { color: #e5484d; border-color: #e5484d; }

.fs-art-wrap { position: relative; flex-shrink: 0; display: flex; align-items: center; gap: 20px; width: 100%; justify-content: center; }
.fs-vinyl-waves {
  flex: 1;
  height: clamp(140px, 18vw, 240px);
  pointer-events: none;
  display: flex; align-items: center; justify-content: space-evenly;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
}
.fs-vinyl-wave-bar {
  flex: 1;
  max-width: 14px;
  min-width: 8px;
  margin: 0 4px;
  height: 60%;
  border-radius: 4px;
  background: rgba(255,255,255,.22);
  transform-origin: center;
  animation: waveBar 1.1s ease-in-out infinite alternate;
  animation-play-state: paused;
}
.fs-vinyl-waves.playing .fs-vinyl-wave-bar { animation-play-state: running; }
.fs-vinyl-wave-bar:nth-child(1) { animation-duration: 1.0s; transform: scaleY(0.3); }
.fs-vinyl-wave-bar:nth-child(2) { animation-duration: 1.3s; transform: scaleY(0.5); }
.fs-vinyl-wave-bar:nth-child(3) { animation-duration: 0.9s; transform: scaleY(0.7); }
.fs-vinyl-wave-bar:nth-child(4) { animation-duration: 1.2s; transform: scaleY(0.4); }
.fs-vinyl-wave-bar:nth-child(5) { animation-duration: 0.8s; transform: scaleY(0.6); }
.fs-vinyl-wave-bar:nth-child(6) { animation-duration: 1.4s; transform: scaleY(0.35); }
.fs-vinyl-wave-bar:nth-child(7) { animation-duration: 1.0s; transform: scaleY(0.55); }
.fs-vinyl-wave-bar:nth-child(8) { animation-duration: 0.85s; transform: scaleY(0.45); }
@keyframes waveBar { from { transform: scaleY(0.15); opacity: .15; } to { transform: scaleY(0.85); opacity: .45; } }
.fs-art, .fs-art-placeholder { position: relative; z-index: 1; flex-shrink: 0; }

.fs-right { display: flex; flex-direction: column; overflow: hidden; min-width: 0; }

.fs-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,.08); flex-shrink: 0; padding: 0 20px; }
.fs-tab {
  font-family: 'Geist Mono', monospace; font-size: 10px; font-weight: 600;
  letter-spacing: .1em; text-transform: uppercase; color: rgba(255,255,255,.3);
  padding: 14px 12px; cursor: pointer; border-bottom: 2px solid transparent;
  margin-bottom: -1px; transition: all .1s;
}
.fs-tab:hover { color: rgba(255,255,255,.6); }
.fs-tab.active { color: #fafafa; border-bottom-color: #fafafa; }

.fs-queue { flex: 1; overflow-y: auto; padding: 8px 0; }
.fs-queue-item { display: flex; align-items: center; gap: 10px; padding: 7px 20px; cursor: pointer; transition: background .1s; }
.fs-queue-item:hover { background: rgba(255,255,255,.04); }
.fs-queue-item.current { background: rgba(255,255,255,.07); }
.fs-queue-item img { width: 34px; height: 34px; border-radius: 3px; object-fit: cover; border: 1px solid rgba(255,255,255,.1); flex-shrink: 0; }
.fs-queue-num { font-family: 'Geist Mono', monospace; font-size: 10px; color: rgba(255,255,255,.25); width: 18px; text-align: center; flex-shrink: 0; }
.fs-queue-meta { overflow: hidden; flex: 1; }
.fs-queue-name { font-size: 12px; font-weight: 500; color: rgba(255,255,255,.8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-queue-name.active { color: #fafafa; }
.fs-queue-sub { font-size: 11px; color: rgba(255,255,255,.35); font-family: 'Geist Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-queue-dur { font-family: 'Geist Mono', monospace; font-size: 10px; color: rgba(255,255,255,.25); flex-shrink: 0; }

.fs-related { flex: 1; overflow-y: auto; padding: 12px 0; }
.fs-related-item { display: flex; align-items: center; gap: 10px; padding: 7px 20px; cursor: pointer; transition: background .1s; }
.fs-related-item:hover { background: rgba(255,255,255,.04); }
.fs-related-item img { width: 34px; height: 34px; border-radius: 3px; object-fit: cover; border: 1px solid rgba(255,255,255,.1); }
.fs-related-meta { overflow: hidden; flex: 1; }
.fs-related-name { font-size: 12px; font-weight: 500; color: rgba(255,255,255,.8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-related-sub { font-size: 11px; color: rgba(255,255,255,.35); font-family: 'Geist Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.fs-details { flex: 1; overflow-y: auto; padding: 20px; }
.fs-detail-row { display: flex; gap: 0; border-bottom: 1px solid rgba(255,255,255,.05); padding: 10px 0; }
.fs-detail-key { font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,.25); font-family: 'Geist Mono', monospace; min-width: 90px; padding-top: 1px; }
.fs-detail-val { font-size: 12px; color: rgba(255,255,255,.7); font-family: 'Geist Mono', monospace; line-height: 1.5; }
.fs-detail-val a { color: rgba(255,255,255,.5); text-decoration: none; }
.fs-detail-val a:hover { color: #fafafa; text-decoration: underline; }

.fs-controls {
  border-top: 1px solid rgba(255,255,255,.08);
  padding: 14px 32px 18px;
  background: rgba(9,9,11,.7);
  backdrop-filter: blur(20px);
  flex-shrink: 0;
}
.fs-prog-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.fs-prog-time { font-family: 'Geist Mono', monospace; font-size: 10px; color: rgba(255,255,255,.35); min-width: 32px; }
.fs-prog-rail { flex: 1; height: 3px; background: rgba(255,255,255,.12); cursor: pointer; border-radius: 2px; position: relative; }
.fs-prog-rail:hover .fs-prog-fill { background: rgba(255,255,255,.9); }
.fs-prog-rail:hover .fs-prog-thumb { opacity: 1; }
.fs-prog-fill { height: 100%; background: #fafafa; border-radius: 2px; pointer-events: none; }
.fs-prog-thumb { position: absolute; top: 50%; width: 10px; height: 10px; border-radius: 50%; background: #fafafa; transform: translate(-50%, -50%); opacity: 0; transition: opacity .1s; pointer-events: none; }

.fs-btn-row { display: flex; align-items: center; justify-content: center; gap: 20px; }
.fs-ctrl { background: none; border: none; cursor: pointer; color: rgba(255,255,255,.4); display: flex; align-items: center; padding: 6px; border-radius: 4px; transition: all .1s; }
.fs-ctrl:hover { color: #fafafa; background: rgba(255,255,255,.06); }
.fs-ctrl.active { color: #fafafa; }
.fs-play-btn { background: #fafafa; border: none; width: 40px; height: 40px; border-radius: 5px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all .1s; flex-shrink: 0; }
.fs-play-btn:hover { background: #e4e4e7; transform: scale(1.04); }
.fs-play-btn:active { transform: scale(.97); }

.fs-side-controls { display: flex; align-items: center; gap: 12px; }
.fs-vol-wrap { display: flex; align-items: center; gap: 7px; }
.fs-vol-range { -webkit-appearance: none; width: 80px; height: 3px; background: rgba(255,255,255,.15); border-radius: 2px; outline: none; cursor: pointer; }
.fs-vol-range::-webkit-slider-thumb { -webkit-appearance: none; width: 10px; height: 10px; background: #fafafa; border-radius: 50%; }

.fs-close { position: absolute; top: 14px; right: 14px; z-index: 10; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 4px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: rgba(255,255,255,.5); transition: all .1s; }
.fs-close:hover { color: #fafafa; background: rgba(255,255,255,.1); }

.fs-eq { display: flex; align-items: flex-end; gap: 1.5px; height: 12px; }
.fs-eq-b { width: 2.5px; background: #fafafa; border-radius: 1px; animation: eqa .6s ease-in-out infinite alternate; animation-play-state: inherit; }
.fs-eq-b:nth-child(2) { animation-delay: .15s; }
.fs-eq-b:nth-child(3) { animation-delay: .3s; }

@media (max-width: 800px) {
  .fs-main { grid-template-columns: 1fr !important; grid-template-rows: auto 1fr; }
  .fs-main.sidebar-open { grid-template-columns: 1fr !important; }
  .fs-left { padding: 20px 20px 14px; flex-direction: row; gap: 14px; align-items: center; border-right: none; border-bottom: 1px solid rgba(255,255,255,.07); }
  .fs-art, .fs-art-placeholder { width: 72px; height: 72px; }
  .fs-art.playing { box-shadow: none; transform: none; }
  .fs-meta { text-align: left; }
  .fs-vinyl-waves { display: none; }
  .fs-track-title { font-size: 13px; }
  .fs-controls { padding: 12px 16px 14px; }
  .fs-btn-row { gap: 12px; }
}

/* ── COMMAND PALETTE ── */
.cmd-backdrop { position: fixed; inset: 0; z-index: 300; background: rgba(0,0,0,.45); backdrop-filter: blur(4px); animation: fadeIn .15s ease; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.cmd-box { position: fixed; top: 18vh; left: 50%; transform: translateX(-50%); z-index: 301; width: min(580px, 92vw); background: var(--bg); border: 2px solid var(--tx); border-radius: var(--r); box-shadow: var(--shadow-lg); animation: cmdIn .15s cubic-bezier(.4,0,.2,1); overflow: hidden; }
@keyframes cmdIn { from { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(.98); } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }
.cmd-input-wrap { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: var(--line); }
.cmd-input { flex: 1; background: none; border: none; outline: none; font-size: 14px; font-family: 'Geist', sans-serif; color: var(--tx); }
.cmd-input::placeholder { color: var(--tx3); }
.cmd-hint { font-family: 'Geist Mono', monospace; font-size: 10px; color: var(--tx3); white-space: nowrap; }
.cmd-results { max-height: 360px; overflow-y: auto; }
.cmd-section { font-family: 'Geist Mono', monospace; font-size: 9px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--tx3); padding: 8px 16px 4px; }
.cmd-item { display: flex; align-items: center; gap: 10px; padding: 8px 16px; cursor: pointer; transition: background .1s; }
.cmd-item:hover, .cmd-item.selected { background: var(--bg3); }
.cmd-item-icon { width: 28px; height: 28px; border-radius: 3px; background: var(--bg3); border: var(--line); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--tx3); }
.cmd-item-img { width: 28px; height: 28px; border-radius: 3px; object-fit: cover; border: var(--line); flex-shrink: 0; }
.cmd-item-label { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmd-item-sub { font-size: 11px; color: var(--tx3); font-family: 'Geist Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmd-item-meta { overflow: hidden; flex: 1; }
.cmd-item-kbd { font-family: 'Geist Mono', monospace; font-size: 10px; color: var(--tx3); flex-shrink: 0; }
.cmd-empty { padding: 32px 16px; text-align: center; color: var(--tx3); font-size: 12px; font-family: 'Geist Mono', monospace; }

/* ── LYRICS PAGE ── */
.lyrics-page { position: relative; height: 100%; display: flex; flex-direction: column; overflow: hidden; background: #09090b; }
.lyrics-bg { position: absolute; inset: -40px; background-size: cover; background-position: center; filter: blur(70px) saturate(1.6); opacity: .25; pointer-events: none; }
.lyrics-scrim { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(0,0,0,.5), rgba(0,0,0,.8)); pointer-events: none; }
.lyrics-header { position: relative; z-index: 2; display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,.07); flex-shrink: 0; }
.lyrics-header-art { width: 36px; height: 36px; border-radius: 3px; object-fit: cover; border: 1px solid rgba(255,255,255,.12); flex-shrink: 0; }
.lyrics-header-title { font-size: 13px; font-weight: 600; color: #fafafa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lyrics-header-artist { font-size: 11px; color: rgba(255,255,255,.4); font-family: 'Geist Mono', monospace; }
.lyrics-header-meta { overflow: hidden; flex: 1; }
.lyrics-body { position: relative; z-index: 2; flex: 1; overflow: hidden; mask-image: linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%); }
.lyrics-scroll { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 45vh 24px; transition: transform .45s cubic-bezier(.4,0,.2,1); will-change: transform; }
.lyrics-line { font-size: clamp(20px, 2.8vw, 32px); font-weight: 700; letter-spacing: -.025em; color: rgba(255,255,255,.2); line-height: 1.55; text-align: center; transition: color .35s, transform .35s; cursor: default; padding: 2px 0; }
.lyrics-line.active { color: #ffffff; transform: scale(1.05); }
.lyrics-line.near { color: rgba(255,255,255,.5); }
.lyrics-line.empty { height: .8em; }
.lyrics-idle { position: relative; z-index: 2; flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; color: rgba(255,255,255,.25); font-family: 'Geist Mono', monospace; font-size: 12px; }
.lyrics-loading { position: relative; z-index: 2; flex: 1; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,.25); font-family: 'Geist Mono', monospace; font-size: 12px; }

/* ── SLEEP TIMER ── */
.sleep-btn { position: relative; }
.sleep-badge { position: absolute; top: -4px; right: -4px; background: var(--tx); color: var(--bg); font-family: 'Geist Mono', monospace; font-size: 8px; font-weight: 700; padding: 1px 3px; border-radius: 2px; pointer-events: none; }

/* ── STATS PAGE ── */
.stats-hero { padding: 24px 20px 20px; border-bottom: var(--line); display: flex; align-items: flex-end; gap: 20px; flex-wrap: wrap; }
.stats-num { font-size: 48px; font-weight: 700; letter-spacing: -.04em; font-family: 'Geist Mono', monospace; line-height: 1; }
.stats-label { font-size: 11px; color: var(--tx3); font-family: 'Geist Mono', monospace; margin-top: 4px; text-transform: uppercase; letter-spacing: .08em; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); border-left: var(--line); }
.stats-grid > * { border-right: var(--line); border-bottom: var(--line); }
.stats-cell { padding: 16px; }
.stats-cell-val { font-size: 22px; font-weight: 700; letter-spacing: -.03em; font-family: 'Geist Mono', monospace; }
.stats-cell-key { font-size: 10px; color: var(--tx3); font-family: 'Geist Mono', monospace; text-transform: uppercase; letter-spacing: .07em; margin-top: 3px; }
.stats-bar-row { display: flex; align-items: center; gap: 10px; padding: 7px 16px; border-bottom: var(--line); }
.stats-bar-label { font-size: 12px; font-weight: 500; min-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stats-bar-track { flex: 1; height: 4px; background: var(--bg3); border-radius: 2px; }
.stats-bar-fill { height: 100%; background: var(--tx); border-radius: 2px; }
.stats-bar-count { font-family: 'Geist Mono', monospace; font-size: 11px; color: var(--tx3); min-width: 28px; text-align: right; }

/* ── ACCENT TINT ── */
.accent-tint { transition: --accent-tint .6s; }

/* ── CUSTOM PLAYLISTS ── */
.pl-create-btn { display: inline-flex; align-items: center; gap: 6px; background: none; border: var(--line); border-radius: var(--r2); padding: 5px 12px; font-size: 12px; font-family: 'Geist Mono', monospace; color: var(--tx2); cursor: pointer; transition: all .1s; }
.pl-create-btn:hover { background: var(--bg3); color: var(--tx); border-color: var(--border2); }
.pl-modal-backdrop { position: fixed; inset: 0; z-index: 300; background: rgba(0,0,0,.45); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; }
.pl-modal { background: var(--bg); border: 2px solid var(--tx); border-radius: var(--r); padding: 20px; width: min(360px, 92vw); box-shadow: var(--shadow-lg); }
.pl-modal-title { font-size: 14px; font-weight: 700; letter-spacing: -.02em; margin-bottom: 12px; }
.pl-modal-input { width: 100%; padding: 7px 10px; background: var(--bg3); border: var(--line); border-radius: var(--r2); font-size: 13px; font-family: 'Geist', sans-serif; color: var(--tx); outline: none; margin-bottom: 12px; }
.pl-modal-input:focus { border-color: var(--border2); }
.pl-modal-btns { display: flex; gap: 8px; justify-content: flex-end; }
.pl-modal-btn { padding: 6px 14px; border-radius: var(--r2); font-size: 12px; font-family: 'Geist', sans-serif; cursor: pointer; border: var(--line); background: none; color: var(--tx2); }
.pl-modal-btn.primary { background: var(--tx); color: var(--bg); border-color: var(--tx); }
.pl-modal-btn:hover { background: var(--bg3); }
.pl-modal-btn.primary:hover { opacity: .85; }
.pl-card { padding: 14px; cursor: pointer; position: relative; }
.pl-card:hover { background: var(--bg2); }
.pl-card-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-card-sub { font-size: 11px; color: var(--tx3); font-family: 'Geist Mono', monospace; margin-top: 2px; }
.pl-card-icon { width: 100%; aspect-ratio: 1; background: var(--bg3); border: var(--line); border-radius: var(--r2); display: flex; align-items: center; justify-content: center; margin-bottom: 10px; color: var(--tx3); }
.pl-card-delete { position: absolute; top: 8px; right: 8px; background: none; border: var(--line); border-radius: var(--r2); width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--tx3); opacity: 0; transition: opacity .1s; }
.pl-card:hover .pl-card-delete { opacity: 1; }
.pl-card-delete:hover { color: var(--red); border-color: var(--red); background: rgba(229,72,77,.06); }
.add-to-pl-menu { position: fixed; z-index: 200; background: var(--bg); border: 2px solid var(--tx); border-radius: var(--r); box-shadow: var(--shadow-lg); min-width: 180px; overflow: hidden; animation: cmdIn .12s ease; }
.add-to-pl-item { padding: 8px 14px; font-size: 12px; cursor: pointer; white-space: nowrap; display: flex; align-items: center; gap: 8px; }
.add-to-pl-item:hover { background: var(--bg3); }

/* ── SIMILAR TRACKS ── */
.similar-btn { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; color: var(--tx3); cursor: pointer; background: none; border: var(--line); padding: 4px 10px; border-radius: var(--r2); font-family: 'Geist Mono', monospace; transition: all .1s; }
.similar-btn:hover { color: var(--tx); background: var(--bg3); border-color: var(--border2); }

/* ── AUTH ── */
.auth-modal-backdrop { position: fixed; inset: 0; z-index: 400; background: rgba(0,0,0,.55); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; animation: fadeIn .15s ease; }
.auth-modal { background: var(--bg); border: 2px solid var(--tx); border-radius: var(--r); width: min(400px, 94vw); box-shadow: var(--shadow-lg); overflow: hidden; }
.auth-modal-header { padding: 20px 20px 0; display: flex; align-items: center; gap: 10px; }
.auth-modal-logo { display: flex; align-items: center; gap: 7px; }
.auth-modal-title { font-size: 15px; font-weight: 700; letter-spacing: -.02em; }
.auth-tabs { display: flex; border-bottom: var(--line); margin-top: 16px; padding: 0 20px; }
.auth-tab { font-family: 'Geist Mono', monospace; font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--tx3); padding: 10px 10px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all .1s; }
.auth-tab.active { color: var(--tx); border-bottom-color: var(--tx); }
.auth-body { padding: 20px; display: flex; flex-direction: column; gap: 10px; }
.auth-input { width: 100%; padding: 8px 11px; background: var(--bg3); border: var(--line); border-radius: var(--r2); font-size: 13px; font-family: 'Geist', sans-serif; color: var(--tx); outline: none; }
.auth-input:focus { border-color: var(--border2); box-shadow: 0 0 0 3px rgba(0,112,243,.1); }
.auth-btn { width: 100%; padding: 9px; background: var(--tx); color: var(--bg); border: none; border-radius: var(--r2); font-size: 13px; font-weight: 600; font-family: 'Geist', sans-serif; cursor: pointer; transition: opacity .1s; }
.auth-btn:hover { opacity: .85; }
.auth-btn.secondary { background: none; color: var(--tx2); border: var(--line); }
.auth-btn.secondary:hover { background: var(--bg3); opacity: 1; }
.auth-error { font-size: 11px; color: var(--red); font-family: 'Geist Mono', monospace; }
.auth-success { font-size: 11px; color: var(--green); font-family: 'Geist Mono', monospace; }
.auth-divider { display: flex; align-items: center; gap: 10px; color: var(--tx3); font-size: 11px; font-family: 'Geist Mono', monospace; }
.auth-divider::before, .auth-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.auth-footer { padding: 0 20px 16px; text-align: center; font-size: 11px; color: var(--tx3); font-family: 'Geist Mono', monospace; }
/* User chip in topbar */
.user-chip { display: flex; align-items: center; gap: 6px; padding: 3px 8px 3px 3px; border: var(--line); border-radius: 20px; cursor: pointer; transition: all .1s; background: none; font-family: 'Geist Mono', monospace; font-size: 10px; color: var(--tx2); }
.user-chip:hover { background: var(--bg3); color: var(--tx); }
/* User dropdown */
.user-dropdown { position: fixed; z-index: 300; background: var(--bg); border: 2px solid var(--tx); border-radius: var(--r); box-shadow: var(--shadow-lg); min-width: 210px; overflow: hidden; animation: cmdIn .12s ease; }
.user-dropdown-header { padding: 12px 14px; border-bottom: var(--line); display: flex; align-items: center; gap: 10px; }
.user-dropdown-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.user-dropdown-avatar-ph { width: 36px; height: 36px; border-radius: 50%; background: var(--tx); color: var(--bg); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; flex-shrink: 0; }
.user-dropdown-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-dropdown-email { font-size: 10px; color: var(--tx3); font-family: 'Geist Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-dropdown-item { display: flex; align-items: center; gap: 9px; padding: 9px 14px; font-size: 12px; cursor: pointer; transition: background .1s; color: var(--tx2); }
.user-dropdown-item:hover { background: var(--bg3); color: var(--tx); }
.user-dropdown-item.danger { color: var(--red); }
.user-dropdown-item.danger:hover { background: rgba(229,72,77,.06); }
/* Auth modal close */
.auth-modal-close { position: absolute; top: 12px; right: 12px; background: none; border: var(--line); border-radius: var(--r2); width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--tx3); transition: all .1s; }
.auth-modal-close:hover { color: var(--tx); background: var(--bg3); }
/* Download */
.dl-btn { background: none; border: none; cursor: pointer; color: var(--tx3); padding: 3px; display: flex; transition: color .1s; }
.dl-btn:hover { color: var(--tx); }
.user-avatar { width: 20px; height: 20px; border-radius: 50%; background: var(--tx); color: var(--bg); display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; flex-shrink: 0; }

/* ── MOBILE ── */
@media (max-width: 680px) {
  html, body { overflow: auto; }
  .shell { grid-template-columns: 1fr; grid-template-rows: 1fr 64px 52px; height: 100dvh; position: fixed; width: 100%; top: 0; left: 0; }
  .shell.nav-collapsed { grid-template-columns: 1fr; }
  .nav { display: none; }
  .sidebar-toggle-btn { display: none; }
  .player { grid-column: 1/2; grid-template-columns: 1fr auto; border-top: 2px solid var(--tx); }
  .pl-right { display: none; }
  .pl-center { padding: 0 10px; }
  .prog-row { display: none; }
  .pl-btns { gap: 8px; }
  .topbar { padding: 0 10px; gap: 6px; }
  .srch-form { max-width: none; }
  .topbar-right { gap: 3px; }
  .chip { display: none; }
  .icon-btn { width: 26px; height: 26px; }
  .cgrid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
  .ehero { grid-template-columns: 100px 1fr; }
  .ehero-img { width: 80px; height: 80px; }
  .entity-name { font-size: 18px; }
  .settings-grid { grid-template-columns: 1fr; }
  .ph { padding: 14px 14px 12px; }
  .pt { font-size: 17px; }
  .ttbl th:nth-child(3), .ttbl td:nth-child(3) { display: none; }
  .mobile-nav { display: flex !important; }
}
.mobile-nav {
  display: none;
  grid-column: 1/3;
  background: var(--surface);
  border-top: var(--line);
  align-items: stretch;
}
.mobile-nav-item {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; cursor: pointer; color: var(--tx3); transition: color .1s; padding: 6px 0;
  font-family: 'Geist Mono', monospace; font-size: 9px; font-weight: 600; letter-spacing: .05em;
  text-transform: uppercase; border: none; background: none;
}
.mobile-nav-item.active { color: var(--tx); }
.mobile-nav-item svg { flex-shrink: 0; }

/* Mobile player strip — compact single row */
@media (max-width: 680px) {
  .player { min-height: 64px; }
  .pl-track { padding: 0 10px; gap: 8px; }
  .pl-thumb { width: 36px; height: 36px; }
  .pl-title { font-size: 12px; }
  .pl-artist { font-size: 10px; }
  .ctrl-btn { padding: 3px; }
  .play-main-btn { width: 26px; height: 26px; }
}
`;

/* ─── HASH ROUTER ───────────────────────────────────────────────── */
const SIMPLE_VIEWS = ["home", "browse", "liked", "settings", "stats", "lyrics", "search", "playlist", "album", "artist", "genre", "library", "similar", "custom_playlist"];
function getHashView() {
  const h = window.location.hash.replace(/^#\/?/, "").replace(/\/$/, "") || "home";
  return SIMPLE_VIEWS.includes(h) ? h : "home";
}
function useHashView() {
  const [view, setViewState] = useState(getHashView);
  const setView = useCallback((v) => {
    window.location.hash = `/${v}/`;
  }, []);
  useEffect(() => {
    const onPop = () => setViewState(getHashView());
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("hashchange", onPop); };
  }, []);
  return [view, setView];
}

/* ─── AUTH MODAL ────────────────────────────────────────────────── */
const AuthModal = memo(({ onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const signInWithGoogle = async () => {
    setLoading(true); setError("");
    try {
      const redirectTo = window.location.href.split("#")[0];
      const r = await fetch(`${SB_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "GET", headers: { "apikey": SB_KEY }, redirect: "manual",
      });
      // Supabase returns a redirect — follow it
      const url = r.headers.get("location") || r.url;
      if (url && url.includes("accounts.google.com")) {
        window.location.href = url;
      } else {
        // Direct browser to the auth URL
        window.location.href = `${SB_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
      }
    } catch {
      window.location.href = `${SB_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(window.location.href.split("#")[0])}`;
    }
  };

  useEffect(() => {
    const fn = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  return (
    <div className="auth-modal-backdrop" onClick={onClose}>
      <div className="auth-modal" style={{ textAlign: "center", position: "relative" }} onClick={e => e.stopPropagation()}>
        <button className="auth-modal-close" onClick={onClose}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        {/* Header */}
        <div style={{ padding: "28px 28px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <WaveLogo size={28} />
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.03em" }}>Sign in to WAVE</div>
          <div style={{ fontSize: 12, color: "var(--tx3)", fontFamily: "'Geist Mono',monospace" }}>
            save playlists · sync across devices
          </div>
        </div>

        {/* Buttons */}
        <div style={{ padding: "24px 28px 28px", display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={signInWithGoogle}
            disabled={loading}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              width: "100%", padding: "11px 16px", background: "var(--bg3)",
              border: "var(--line)", borderRadius: "var(--r2)", cursor: "pointer",
              fontSize: 13, fontWeight: 600, fontFamily: "'Geist',sans-serif", color: "var(--tx)",
              transition: "all .1s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--bg2)"}
            onMouseLeave={e => e.currentTarget.style.background = "var(--bg3)"}
          >
            {/* Google logo */}
            <svg width="16" height="16" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.3 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.6-8 19.6-20 0-1.3-.1-2.7-.4-4z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35.5 26.8 36 24 36c-5.3 0-9.7-3.6-11.3-8.5l-6.5 5C9.5 39.5 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.3 4.2-4.3 5.5l6.2 5.2C41.1 35.3 44 30 44 24c0-1.3-.1-2.7-.4-4z"/>
            </svg>
            {loading ? "Redirecting…" : "Continue with Google"}
          </button>

          {error && <div className="auth-error" style={{ textAlign: "center" }}>{error}</div>}

          <div style={{ fontSize: 10, color: "var(--tx3)", fontFamily: "'Geist Mono',monospace", marginTop: 4, lineHeight: 1.6 }}>
            By signing in you agree to our terms.<br />Your data is stored securely in Supabase.
          </div>
        </div>
      </div>
    </div>
  );
});

/* ─── COMMAND PALETTE ───────────────────────────────────────────── */
const CommandPalette = memo(({ onClose, recent, liked, charts, queue, current, onPlay, onNav, onAction }) => {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const actions = [
    { label: "Saved tracks", sub: `${liked.length} tracks`, icon: "♥", action: () => onNav("liked") },
    { label: "Browse genres", sub: "explore", icon: "◈", action: () => onNav("browse") },
    { label: "Stats", sub: "listening history", icon: "↗", action: () => onNav("stats") },
    { label: "Settings", sub: "preferences", icon: "⚙", action: () => onNav("settings") },
    { label: "Toggle fullscreen", sub: "F", icon: "⛶", action: () => onAction("fullscreen") },
    { label: "Toggle shuffle", sub: "S", icon: "⇄", action: () => onAction("shuffle") },
    { label: "Toggle dark mode", sub: "", icon: "◑", action: () => onAction("darkmode") },
    { label: "Sleep timer", sub: "", icon: "☽", action: () => onAction("sleep") },
    { label: "Show lyrics", sub: "", icon: "♪", action: () => onAction("lyrics") },
  ];

  const trackPool = [...(q ? [] : recent.slice(0, 5)), ...(q ? [...liked, ...charts] : [])];
  const filtered = q
    ? { actions: actions.filter(a => a.label.toLowerCase().includes(q.toLowerCase())), tracks: trackPool.filter(t => t.title?.toLowerCase().includes(q.toLowerCase()) || t.artist?.name?.toLowerCase().includes(q.toLowerCase())).slice(0, 6) }
    : { actions, tracks: recent.slice(0, 4) };

  const flat = [...filtered.actions, ...filtered.tracks];

  useEffect(() => { setSel(0); }, [q]);

  useEffect(() => {
    const fn = e => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, flat.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = flat[sel];
        if (!item) return;
        if (item.action) { item.action(); onClose(); }
        else { onPlay(item, [item], 0); onClose(); }
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [flat, sel, onClose]);

  let idx = 0;
  return (
    <>
      <div className="cmd-backdrop" onClick={onClose} />
      <div className="cmd-box">
        <div className="cmd-input-wrap">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--tx3)", flexShrink: 0 }} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <input ref={inputRef} className="cmd-input" placeholder="Search tracks, jump to page…" value={q} onChange={e => setQ(e.target.value)} />
          <span className="cmd-hint">esc to close</span>
        </div>
        <div className="cmd-results">
          {filtered.actions.length > 0 && <>
            <div className="cmd-section">{q ? "Actions" : "Quick actions"}</div>
            {filtered.actions.map(a => {
              const i = idx++;
              return <div key={a.label} className={`cmd-item${sel === i ? " selected" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => { a.action(); onClose(); }}>
                <div className="cmd-item-icon"><span style={{ fontSize: 12 }}>{a.icon}</span></div>
                <div className="cmd-item-meta"><div className="cmd-item-label">{a.label}</div>{a.sub && <div className="cmd-item-sub">{a.sub}</div>}</div>
              </div>;
            })}
          </>}
          {filtered.tracks.length > 0 && <>
            <div className="cmd-section">{q ? "Tracks" : "Recently played"}</div>
            {filtered.tracks.map(t => {
              const i = idx++;
              return <div key={t.id} className={`cmd-item${sel === i ? " selected" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => { onPlay(t, [t], 0); onClose(); }}>
                {t.album?.cover_small ? <img className="cmd-item-img" src={t.album.cover_small} alt="" /> : <div className="cmd-item-icon"><svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /></svg></div>}
                <div className="cmd-item-meta"><div className="cmd-item-label">{t.title}</div><div className="cmd-item-sub">{t.artist?.name}</div></div>
                <span className="cmd-item-kbd">{fmt(t.duration)}</span>
              </div>;
            })}
          </>}
          {flat.length === 0 && <div className="cmd-empty">no results for "{q}"</div>}
        </div>
      </div>
    </>
  );
});

/* ─── LYRICS PAGE ───────────────────────────────────────────────── */
const LyricsPage = memo(({ current, ytRef }) => {
  const [synced, setSynced] = useState(null);
  const [plain, setPlain] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRef = useRef(null);
  const lineRefs = useRef([]);
  const rafRef = useRef(null);
  const prevIdRef = useRef(null);

  useEffect(() => {
    if (!current || current.id === prevIdRef.current) return;
    prevIdRef.current = current.id;
    setLoading(true); setSynced(null); setPlain(null); setActiveIdx(0);
    fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(current.artist?.name || "")}&track_name=${encodeURIComponent(current.title || "")}&duration=${current.duration || 0}`)
      .then(r => r.json())
      .then(d => {
        if (d.syncedLyrics) {
          const parsed = d.syncedLyrics.split("\n").flatMap(l => {
            const m = l.match(/^\[(\d+):(\d+\.\d+)\](.*)/);
            return m ? [{ time: parseInt(m[1]) * 60 + parseFloat(m[2]), text: m[3].trim() }] : [];
          });
          setSynced(parsed);
        } else if (d.plainLyrics) {
          setPlain(d.plainLyrics.split("\n"));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [current?.id]);

  // Karaoke RAF — only runs when synced lyrics exist
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (!synced) return;
    const tick = () => {
      const t = ytRef.current?.getCurrentTime?.() || 0;
      let idx = 0;
      for (let i = 0; i < synced.length; i++) {
        if (synced[i].time <= t) idx = i; else break;
      }
      setActiveIdx(prev => prev === idx ? prev : idx);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [synced]);

  // Scroll active line to center — purely via transform, no layout
  useEffect(() => {
    const el = lineRefs.current[activeIdx];
    const container = scrollRef.current;
    if (!el || !container) return;
    const containerH = container.parentElement?.clientHeight || 400;
    const offset = el.offsetTop - containerH / 2 + el.clientHeight / 2;
    container.style.transform = `translateY(${-offset}px)`;
  }, [activeIdx]);

  const coverUrl = current?.album?.cover_xl || current?.album?.cover_big || current?.album?.cover_medium || "";

  return (
    <div className="lyrics-page">
      {coverUrl && <div className="lyrics-bg" style={{ backgroundImage: `url(${coverUrl})` }} />}
      <div className="lyrics-scrim" />

      {/* Header */}
      {current && (
        <div className="lyrics-header">
          {current.album?.cover_small && <img className="lyrics-header-art" src={current.album.cover_small} alt="" />}
          <div className="lyrics-header-meta">
            <div className="lyrics-header-title">{current.title}</div>
            <div className="lyrics-header-artist">{current.artist?.name}</div>
          </div>
          {synced && <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: 10, color: "rgba(255,255,255,.3)", flexShrink: 0 }}>● synced</span>}
        </div>
      )}

      {/* No track */}
      {!current && (
        <div className="lyrics-idle">
          <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
          <span>play a track to see lyrics</span>
        </div>
      )}

      {/* Loading */}
      {current && loading && <div className="lyrics-loading">fetching lyrics…</div>}

      {/* No lyrics found */}
      {current && !loading && !synced && !plain && (
        <div className="lyrics-idle"><span>no lyrics found for this track</span></div>
      )}

      {/* Synced karaoke */}
      {current && synced && (
        <div className="lyrics-body">
          <div className="lyrics-scroll" ref={scrollRef}>
            {synced.map((l, i) => (
              <div
                key={i}
                ref={el => { lineRefs.current[i] = el; }}
                className={`lyrics-line${i === activeIdx ? " active" : Math.abs(i - activeIdx) === 1 ? " near" : ""}`}
              >
                {l.text || <span>&nbsp;</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plain fallback */}
      {current && !synced && plain && (
        <div className="lyrics-body">
          <div className="lyrics-scroll" ref={scrollRef}>
            {plain.map((l, i) => (
              <div key={i} className={`lyrics-line${!l.trim() ? " empty" : ""}`}>{l || <span>&nbsp;</span>}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

/* ─── STATS PAGE ────────────────────────────────────────────────── */
const StatsPage = memo(({ recent, liked }) => {
  const totalMin = Math.round(recent.reduce((a, t) => a + (t.duration || 0), 0) / 60);
  const artistCounts = {};
  recent.forEach(t => { const n = t.artist?.name; if (n) artistCounts[n] = (artistCounts[n] || 0) + 1; });
  const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxCount = topArtists[0]?.[1] || 1;
  return (
    <div>
      <div className="ph"><div className="pt">Stats</div><div className="ps">your listening history · {recent.length} tracks played</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderLeft: "var(--line)" }}>
        {[
          { val: recent.length, key: "Tracks played" },
          { val: totalMin, key: "Minutes listened" },
          { val: liked.length, key: "Saved tracks" },
          { val: new Set(recent.map(t => t.artist?.name)).size, key: "Unique artists" },
          { val: new Set(recent.map(t => t.album?.title)).size, key: "Unique albums" },
          { val: Math.round(totalMin / 60 * 10) / 10, key: "Hours total" },
        ].map(s => (
          <div key={s.key} className="stats-cell" style={{ borderRight: "var(--line)", borderBottom: "var(--line)" }}>
            <div className="stats-cell-val">{s.val}</div>
            <div className="stats-cell-key">{s.key}</div>
          </div>
        ))}
      </div>
      {topArtists.length > 0 && <>
        <div className="sec-hd" style={{ marginTop: 0 }}><span className="sec-lbl">Top Artists</span></div>
        {topArtists.map(([name, count]) => (
          <div key={name} className="stats-bar-row">
            <div className="stats-bar-label">{name}</div>
            <div className="stats-bar-track"><div className="stats-bar-fill" style={{ width: `${(count / maxCount) * 100}%` }} /></div>
            <div className="stats-bar-count">{count}</div>
          </div>
        ))}
      </>}
      {recent.length === 0 && <div className="empty"><div className="empty-title">No history yet</div><div className="empty-sub">play some tracks to see stats</div></div>}
    </div>
  );
});

/* ─── LOGO COMPONENT ────────────────────────────────────────────── */
const WaveLogo = ({ size = 20 }) => {
  const bars = [4, 10, 16, 8, 14, 6, 12];
  return (
    <div className="logo-mark" style={{ height: size }}>
      {bars.map((h, i) => (
        <span key={i} style={{ width: 2.5, height: h * (size / 20), borderRadius: 1.5 }} />
      ))}
    </div>
  );
};

/* ─── TOGGLE ────────────────────────────────────────────────────── */
const Toggle = ({ checked, onChange }) => (
  <label className="toggle">
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
    <span className="toggle-slider" />
  </label>
);

/* ─── CARD GRID ─────────────────────────────────────────────────── */
const CardGrid = ({ items, onClick, imgFn, titleFn, subFn, round = false }) => (
  <div className="cgrid">
    {items.map(item => (
      <div key={item.id} className="gc" onClick={() => onClick(item)}>
        <img className={`gc-img${round ? " round" : ""}`} src={imgFn(item) || ""} alt="" />
        <div className="gc-title">{titleFn(item)}</div>
        <div className="gc-sub">{subFn(item)}</div>
        <div className="gc-play"><svg width="11" height="11" fill="var(--bg)" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></div>
      </div>
    ))}
  </div>
);

/* ─── TRACK ROW ─────────────────────────────────────────────────── */
const TRow = memo(({ track, index, list, showAlbum, currentId, playing, buffering, liked, onPlay, onLike, onAddToPlaylist, onSimilar, onDownload }) => {
  const active = currentId === track.id;
  const isLiked = liked.some(t => t.id === track.id);
  const isExplicit = track.explicit_lyrics === true || track.explicit_lyrics === 1 || track.explicit_content_lyrics === 1;
  return (
    <tr className={active ? "tr-active" : ""} onClick={() => onPlay(track, list || [track], index)}>
      <td className="td-n">
        {active && playing
          ? <div className="eq" style={{ margin: "0 auto" }}><div className="eq-b" /><div className="eq-b" /><div className="eq-b" /></div>
          : active && buffering
            ? <svg className="spin" width="12" height="12" fill="none" stroke="var(--accent)" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
            : <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: 11 }}>{index + 1}</span>}
      </td>
      <td>
        <div className="td-info">
          {track.album?.cover_small ? <img className="td-art" src={track.album.cover_small} alt="" /> : null}
          <div style={{ overflow: "hidden" }}>
            <div className="td-name">
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</span>
              {isExplicit ? <span className="explicit-tag">E</span> : null}
            </div>
            <div className="td-sub">{track.artist?.name}</div>
          </div>
        </div>
      </td>
      {showAlbum ? <td className="td-album">{track.album?.title}</td> : null}
      <td className="td-dur">{fmt(track.duration)}</td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
          {onSimilar && (
            <button className="like-btn" title="Similar tracks" onClick={e => { e.stopPropagation(); onSimilar(track); }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3a9 9 0 0 1 9 9M3 12a9 9 0 0 1 9-9" /></svg>
            </button>
          )}
          {onDownload && track.preview && (
            <button className="like-btn" title="Download 30s preview" onClick={e => { e.stopPropagation(); onDownload(track); }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v12m0 0-4-4m4 4 4-4M3 20h18" /></svg>
            </button>
          )}
          {onAddToPlaylist && (
            <button className="like-btn" title="Add to playlist" onClick={e => { e.stopPropagation(); onAddToPlaylist(track, e); }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          )}
          <button className={`like-btn${isLiked ? " liked" : ""}`} onClick={e => { e.stopPropagation(); onLike(track); }}>
            <svg width="13" height="13" fill={isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
});

/* ─── TRACK TABLE ───────────────────────────────────────────────── */
const TTable = memo(({ tracks, showAlbum = true, explicitFilter, currentId, playing, buffering, liked, onPlay, onLike, onAddToPlaylist, onSimilar, onDownload }) => {
  const filtered = explicitFilter
    ? tracks.filter(t => t.explicit_lyrics !== 1 && t.explicit_lyrics !== true && t.explicit_content_lyrics !== 1)
    : tracks;
  if (!filtered.length) return (
    <div className="empty">
      <div className="empty-title">No tracks</div>
      <div className="empty-sub">{explicitFilter ? "All results filtered (explicit filter on)" : "Nothing here yet"}</div>
    </div>
  );
  return (
    <table className="ttbl">
      <thead>
        <tr>
          <th style={{ width: 36 }}>#</th>
          <th>TITLE</th>
          {showAlbum ? <th>ALBUM</th> : null}
          <th className="r">TIME</th>
          <th style={{ width: 36 }}></th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((t, i) => (
          <TRow
            key={t.id}
            track={t} index={i} list={filtered} showAlbum={showAlbum}
            currentId={currentId} playing={playing} buffering={buffering}
            liked={liked} onPlay={onPlay} onLike={onLike}
            onAddToPlaylist={onAddToPlaylist} onSimilar={onSimilar} onDownload={onDownload}
          />
        ))}
      </tbody>
    </table>
  );
});

/* ─── WAVE BARS (fully isolated — never re-renders from parent prop changes) ── */
const WaveBars = memo(({ playing }) => (
  <div className={`fs-vinyl-waves${playing ? " playing" : ""}`}>
    {Array.from({ length: 8 }, (_, i) => <div key={i} className="fs-vinyl-wave-bar" />)}
  </div>
));

/* ─── FS PROGRESS BAR (isolated to prevent re-renders hitting wave RAF) ── */
const FsProgressBar = memo(({ playing, currentId, currentDuration, ytRef, onSeek }) => {
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(currentDuration || 0);
  const timerRef = useRef(null);
  const fmt = (s) => { if (!s && s !== 0) return "0:00"; return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`; };

  useEffect(() => {
    clearInterval(timerRef.current);
    if (playing) {
      timerRef.current = setInterval(() => {
        const t = ytRef.current?.getCurrentTime?.();
        const d = ytRef.current?.getDuration?.();
        if (t != null) setProgress(t);
        if (d != null) setDuration(d);
      }, 400);
    }
    return () => clearInterval(timerRef.current);
  }, [playing]);

  useEffect(() => { setProgress(0); setDuration(currentDuration || 0); }, [currentId]);

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

  const handleSeek = e => {
    const p = (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.offsetWidth;
    const t = p * (duration || 0);
    setProgress(t);
    onSeek(t);
  };

  return (
    <div className="fs-prog-row">
      <span className="fs-prog-time">{fmt(progress)}</span>
      <div className="fs-prog-rail" onClick={handleSeek}>
        <div className="fs-prog-fill" style={{ width: `${pct}%` }} />
        <div className="fs-prog-thumb" style={{ left: `${pct}%` }} />
      </div>
      <span className="fs-prog-time" style={{ textAlign: "right" }}>{fmt(duration)}</span>
    </div>
  );
});

const FsSidebarToggle = memo(({ open, onClick }) => (
  <button className={`fs-sidebar-toggle${open ? " open" : ""}`} onClick={onClick} title="Toggle queue sidebar">
    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  </button>
));

/* ─── FULLSCREEN VIEW ───────────────────────────────────────────── */
const FullscreenView = memo(({
  current, queue, qIdx, playing, buffering, shuffle, repeat,
  liked, volume, ytRef,
  onClose, onTogglePlay, onAdvance, onSeek, onVolume, onLike,
  onShuffle, onRepeat, onPlayFromQueue,
  relatedTracks = [],
}) => {
  const [activeTab, setActiveTab] = useState("queue");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isLiked = liked.some(t => t.id === current?.id);

  useEffect(() => {
    const fn = e => {
      if (e.key === "Escape" || e.code === "KeyF") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);


  const coverUrl = current?.album?.cover_xl || current?.album?.cover_big || current?.album?.cover_medium || "";

  return (
    <div className="fs-overlay" role="dialog" aria-modal="true">
      {coverUrl && <div className="fs-bg" style={{ backgroundImage: `url(${coverUrl})` }} />}

      <button className="fs-close" onClick={onClose} title="Close (Esc / F)">
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      <div className={`fs-main${sidebarOpen ? " sidebar-open" : ""}`}>
        {/* LEFT PANEL */}
        <div className="fs-left">
          <button
            className={`fs-sidebar-toggle${sidebarOpen ? " open" : ""}`}
            onClick={() => setSidebarOpen(s => !s)}
            title="Toggle queue sidebar"
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
          </button>

          <div className="fs-art-wrap">
            <WaveBars playing={playing} />
            {coverUrl
              ? <img className={`fs-art${playing ? " playing" : ""}`} src={coverUrl} alt="" />
              : <div className="fs-art-placeholder">
                  <svg width="48" height="48" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                  </svg>
                </div>}
            <WaveBars playing={playing} />
          </div>

          <div className="fs-meta">
            <div className="fs-track-title">{current?.title || "No track playing"}</div>
            <div className="fs-track-artist">{current?.artist?.name || "—"}</div>
            {current?.album?.title && (
              <div className="fs-track-album">
                {current.album.title}{current.album.release_date ? ` · ${current.album.release_date.slice(0, 4)}` : ""}
              </div>
            )}
            <div className="fs-actions">
              <button className={`fs-action-btn${isLiked ? " liked" : ""}`} onClick={() => current && onLike(current)} title="Save (L)">
                <svg width="13" height="13" fill={isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </button>
              {current?.link && (
                <button className="fs-action-btn" title="Open on Deezer" onClick={() => window.open(current.link, "_blank")}>
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </button>
              )}
              <button className={`fs-action-btn${shuffle ? " active" : ""}`} onClick={onShuffle} title="Shuffle (S)">
                <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16 3h5v5l-1.5-1.5-4.538 4.538-1.414-1.414L17.5 5.5 16 4V3zM4 5l6.5 6.5-1.414 1.415L3 6.415 4 5zm10.5 9.5L9 10 7.5 11.5 13 17l1.5-1.5zm-4.538-4.538L3 17h2v1l6.5-6.5-1.538-1.538zM16 16l1.5-1.5 3.5 3.5V19h-5v-1l1.5-1.5L16 16z" />
                </svg>
              </button>
              <button className={`fs-action-btn${repeat ? " active" : ""}`} onClick={onRepeat} title="Repeat">
                <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
                </svg>
              </button>
            </div>
          </div>

        </div>

        {/* RIGHT PANEL */}
        <div className="fs-right">
          <div className="fs-tabs">
            {[
              { id: "queue", label: `Queue (${queue.length})` },
              { id: "details", label: "Details" },
              { id: "related", label: "Related" },
            ].map(t => (
              <div key={t.id} className={`fs-tab${activeTab === t.id ? " active" : ""}`} onClick={() => setActiveTab(t.id)}>
                {t.label}
              </div>
            ))}
          </div>

          {activeTab === "queue" && (
            <div className="fs-queue">
              {queue.length === 0
                ? <div style={{ padding: "40px 20px", textAlign: "center", color: "rgba(255,255,255,.25)", fontSize: 12, fontFamily: "'Geist Mono',monospace" }}>no tracks in queue</div>
                : queue.map((t, i) => (
                  <div key={`${t.id}-${i}`} className={`fs-queue-item${i === qIdx ? " current" : ""}`} onClick={() => onPlayFromQueue(t, i)}>
                    <span className="fs-queue-num">
                      {i === qIdx && playing
                        ? <div className="fs-eq"><div className="fs-eq-b" /><div className="fs-eq-b" /><div className="fs-eq-b" /></div>
                        : i + 1}
                    </span>
                    <img src={t.album?.cover_small || ""} alt="" />
                    <div className="fs-queue-meta">
                      <div className={`fs-queue-name${i === qIdx ? " active" : ""}`}>{t.title}</div>
                      <div className="fs-queue-sub">{t.artist?.name}</div>
                    </div>
                    <span className="fs-queue-dur">{fmt(t.duration)}</span>
                  </div>
                ))}
            </div>
          )}

          {activeTab === "details" && (
            <div className="fs-details">
              {!current
                ? <div style={{ color: "rgba(255,255,255,.25)", fontSize: 12, fontFamily: "'Geist Mono',monospace" }}>no track selected</div>
                : <>
                  {[
                    { k: "Title", v: current.title },
                    { k: "Artist", v: current.artist?.name },
                    { k: "Album", v: current.album?.title },
                    { k: "Year", v: current.album?.release_date?.slice(0, 4) || current.release_date?.slice(0, 4) },
                    { k: "Duration", v: fmt(current.duration) },
                    { k: "BPM", v: current.bpm ? `${current.bpm} bpm` : null },
                    { k: "Gain", v: current.gain != null ? `${current.gain.toFixed(2)} dB` : null },
                    { k: "Rank", v: current.rank ? `#${current.rank.toLocaleString()}` : null },
                    { k: "Track ID", v: String(current.id) },
                    { k: "Deezer", v: current.link ? "open ↗" : null, link: current.link },
                  ].filter(r => r.v).map(row => (
                    <div key={row.k} className="fs-detail-row">
                      <div className="fs-detail-key">{row.k}</div>
                      <div className="fs-detail-val">
                        {row.link ? <a href={row.link} target="_blank" rel="noreferrer">{row.v}</a> : row.v}
                      </div>
                    </div>
                  ))}
                  {(current.explicit_lyrics === 1 || current.explicit_lyrics === true) && (
                    <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(229,72,77,.12)", border: "1px solid rgba(229,72,77,.3)", borderRadius: 4, padding: "5px 10px" }}>
                      <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: 10, fontWeight: 700, color: "#e5484d", letterSpacing: ".08em" }}>E</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)", fontFamily: "'Geist Mono',monospace" }}>Explicit content</span>
                    </div>
                  )}
                </>}
            </div>
          )}

          {activeTab === "related" && (
            <div className="fs-related">
              {relatedTracks.length === 0
                ? <div style={{ padding: "40px 20px", textAlign: "center", color: "rgba(255,255,255,.25)", fontSize: 12, fontFamily: "'Geist Mono',monospace" }}>play a track to see related</div>
                : relatedTracks.map((t, i) => (
                  <div key={t.id} className="fs-related-item" onClick={() => onPlayFromQueue(t, i)}>
                    <img src={t.album?.cover_small || ""} alt="" />
                    <div className="fs-related-meta">
                      <div className="fs-related-name">{t.title}</div>
                      <div className="fs-related-sub">{t.artist?.name} · {fmt(t.duration)}</div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM CONTROLS */}
      <div className="fs-controls">
        <FsProgressBar playing={playing} currentId={current?.id} currentDuration={current?.duration} ytRef={ytRef} onSeek={onSeek} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
          <div className="fs-side-controls">
            <div className="fs-vol-wrap">
              <svg width="12" height="12" fill="currentColor" style={{ color: "rgba(255,255,255,.3)", flexShrink: 0 }} viewBox="0 0 24 24">
                {volume === 0
                  ? <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  : volume < 50
                    ? <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
                    : <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />}
              </svg>
              <input type="range" min="0" max="100" value={volume} onChange={e => onVolume(Number(e.target.value))} className="fs-vol-range" />
            </div>
          </div>

          <div className="fs-btn-row" style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }}>
            <button className={`fs-ctrl${shuffle ? " active" : ""}`} onClick={onShuffle} title="Shuffle (S)">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M16 3h5v5l-1.5-1.5-4.538 4.538-1.414-1.414L17.5 5.5 16 4V3zM4 5l6.5 6.5-1.414 1.415L3 6.415 4 5zm10.5 9.5L9 10 7.5 11.5 13 17l1.5-1.5zm-4.538-4.538L3 17h2v1l6.5-6.5-1.538-1.538zM16 16l1.5-1.5 3.5 3.5V19h-5v-1l1.5-1.5L16 16z" /></svg>
            </button>
            <button className="fs-ctrl" onClick={() => onAdvance(-1)}>
              <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
            </button>
            <button className="fs-play-btn" onClick={onTogglePlay}>
              {buffering
                ? <svg className="spin" width="14" height="14" fill="none" stroke="#09090b" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                : playing
                  ? <svg width="14" height="14" fill="#09090b" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                  : <svg width="14" height="14" fill="#09090b" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
            </button>
            <button className="fs-ctrl" onClick={() => onAdvance(1)}>
              <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z" /></svg>
            </button>
            <button className={`fs-ctrl${repeat ? " active" : ""}`} onClick={onRepeat}>
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" /></svg>
            </button>
          </div>

          <div className="fs-side-controls" style={{ justifyContent: "flex-end" }}>
            <div className="fs-eq" style={{ animationPlayState: playing && !buffering ? "running" : "paused" }}><div className="fs-eq-b" /><div className="fs-eq-b" /><div className="fs-eq-b" /></div>
            <button className="fs-action-btn" onClick={onClose} title="Exit fullscreen (F / Esc)" style={{ marginLeft: 8 }}>
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

/* ─── PLAYER BAR ────────────────────────────────────────────────── */
const PlayerBar = memo(({ current, playing, buffering, shuffle, repeat, liked, volume,
  onTogglePlay, onAdvance, onSeek, onVolume, onLike, onShuffle, onRepeat, onFullscreen, ytRef }) => {
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    clearInterval(timerRef.current);
    if (playing) {
      timerRef.current = setInterval(() => {
        const t = ytRef.current?.getCurrentTime?.();
        const d = ytRef.current?.getDuration?.();
        if (t != null) setProgress(t);
        if (d != null && d !== duration) setDuration(d);
        if ("mediaSession" in navigator && t != null && d > 0) {
          try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: 1, position: Math.min(t, d) }); } catch {}
        }
      }, 400);
    }
    return () => clearInterval(timerRef.current);
  }, [playing]);

  useEffect(() => { setProgress(0); setDuration(current?.duration || 0); }, [current?.id]);

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;
  const isLiked = liked.some(t => t.id === current?.id);

  const handleSeek = e => {
    const p = (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.offsetWidth;
    const t = p * (duration || 0);
    setProgress(t);
    onSeek(t);
  };

  return (
    <div className="player">
      <div className="pl-track">
        {current ? (
          <>
            <img className="pl-thumb" src={current.album?.cover_medium || current.album?.cover_small || ""} alt="" />
            <div className="pl-meta">
              <div className="pl-title">{current.title}</div>
              <div className="pl-artist">{current.artist?.name}</div>
            </div>
            <button className={`like-btn${isLiked ? " liked" : ""}`} onClick={() => onLike(current)} style={{ flexShrink: 0, marginLeft: 6 }}>
              <svg width="13" height="13" fill={isLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
          </>
        ) : (
          <span style={{ fontSize: 11, color: "var(--tx3)", fontFamily: "'Geist Mono',monospace" }}>no track selected</span>
        )}
      </div>

      <div className="pl-center">
        <div className="pl-btns">
          <button className={`ctrl-btn${shuffle ? " active" : ""}`} onClick={onShuffle} title="Shuffle (S)">
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M16 3h5v5l-1.5-1.5-4.538 4.538-1.414-1.414L17.5 5.5 16 4V3zM4 5l6.5 6.5-1.414 1.415L3 6.415 4 5zm10.5 9.5L9 10 7.5 11.5 13 17l1.5-1.5zm-4.538-4.538L3 17h2v1l6.5-6.5-1.538-1.538zM16 16l1.5-1.5 3.5 3.5V19h-5v-1l1.5-1.5L16 16z" /></svg>
          </button>
          <button className="ctrl-btn" onClick={() => onAdvance(-1)} title="Previous (⌘←)">
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
          </button>
          <button className="play-main-btn" onClick={onTogglePlay} title="Play/Pause (Space)">
            {buffering
              ? <svg className="spin" width="12" height="12" fill="none" stroke="var(--bg)" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
              : playing
                ? <svg width="12" height="12" fill="var(--bg)" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                : <svg width="12" height="12" fill="var(--bg)" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
          </button>
          <button className="ctrl-btn" onClick={() => onAdvance(1)} title="Next (⌘→)">
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z" /></svg>
          </button>
          <button className={`ctrl-btn${repeat ? " active" : ""}`} onClick={onRepeat} title="Repeat">
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" /></svg>
          </button>
        </div>
        <div className="prog-row">
          <span className="prog-time">{fmt(progress)}</span>
          <div className="prog-rail" onClick={handleSeek}>
            <div className="prog-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="prog-time">{fmt(duration)}</span>
        </div>
      </div>

      <div className="pl-right">
        {playing && !buffering && (
          <div className="eq" style={{ marginRight: 4 }}><div className="eq-b" /><div className="eq-b" /><div className="eq-b" /></div>
        )}
        {/* Fullscreen button */}
        <button className="icon-btn" onClick={onFullscreen} title="Fullscreen (F)">
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>
        <div className="vol-wrap">
          <svg width="12" height="12" fill="currentColor" style={{ color: "var(--tx3)", flexShrink: 0 }} viewBox="0 0 24 24">
            {volume === 0
              ? <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
              : volume < 50
                ? <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
                : <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />}
          </svg>
          <input type="range" min="0" max="100" value={volume} onChange={e => onVolume(Number(e.target.value))} className="vol-range" />
        </div>
      </div>
    </div>
  );
});

/* ─── MAIN APP ──────────────────────────────────────────────────── */
export default function App() {
  const [view, setView] = useHashView();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [current, setCurrent] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [queue, setQueue] = useState([]);
  const [qIdx, setQIdx] = useState(0);
  const [liked, setLiked] = useState(() => lsGet("liked", []));
  const [recent, setRecent] = useState(() => lsGet("recent", []));
  const [charts, setCharts] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [genres, setGenres] = useState([]);
  const [selPl, setSelPl] = useState(null); const [plTracks, setPlTracks] = useState([]);
  const [selAlb, setSelAlb] = useState(null); const [albTracks, setAlbTracks] = useState([]);
  const [artist, setArtist] = useState(null);
  const [selGenre, setSelGenre] = useState(null); const [genTracks, setGenTracks] = useState([]);
  const [volume, setVolume] = useState(() => lsGet("volume", 75));
  const [shuffle, setShuffle] = useState(() => lsGet("shuffle", false));
  const [repeat, setRepeat] = useState(() => lsGet("repeat", false));
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(() => lsGet("darkMode", false));
  const [sidebarOpen, setSidebarOpen] = useState(() => lsGet("sidebarOpen", true));
  const [showQueue, setShowQueue] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [explicitFilter, setExplicitFilter] = useState(() => lsGet("explicitFilter", false));
  const [audioQuality, setAudioQuality] = useState(() => lsGet("audioQuality", "high"));
  const [crossfade, setCrossfade] = useState(() => lsGet("crossfade", false));
  const [showLyrics, setShowLyrics] = useState(() => lsGet("showLyrics", false));
  const [autoplay, setAutoplay] = useState(() => lsGet("autoplay", true));
  // NEW: Fullscreen state
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [sleepMins, setSleepMins] = useState(null);
  const [accentColor, setAccentColor] = useState(null);
  const sleepRef = useRef(null);
  // Playlists & similar
  const [playlists, setPlaylists] = useState([]);
  const [publicPlaylists, setPublicPlaylists] = useState([]);
  const [selCustomPl, setSelCustomPl] = useState(null);
  const [customPlTracks, setCustomPlTracks] = useState([]);
  const [showCreatePl, setShowCreatePl] = useState(false);
  const [newPlName, setNewPlName] = useState("");
  const [newPlPublic, setNewPlPublic] = useState(false);
  const [plSearch, setPlSearch] = useState("");
  const [libTab, setLibTab] = useState("mine"); // "mine" | "public"
  const [addToPlMenu, setAddToPlMenu] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  // Auth
  const [user, setUser] = useState(() => { const p = getGoogleProfile(); return p ? { id: getUserId(), ...p } : null; });
  const [authOpen, setAuthOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userChipRef = useRef(null);

  const ytRef = useRef(null);
  const tidalRef = useRef(null); // tracks current tidal track id being played
  const qRef = useRef([]), qIdxRef = useRef(0);
  const shuffleRef = useRef(shuffle), repeatRef = useRef(repeat), volRef = useRef(volume);

  useEffect(() => { qRef.current = queue; }, [queue]);
  useEffect(() => { qIdxRef.current = qIdx; }, [qIdx]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  useEffect(() => { volRef.current = volume; }, [volume]);

  useEffect(() => { lsSet("liked", liked); if (user) userDataSave({ liked }); }, [liked]);
  useEffect(() => { lsSet("recent", recent); if (user) userDataSave({ recent }); }, [recent]);
  useEffect(() => { lsSet("volume", volume); }, [volume]);
  useEffect(() => { lsSet("shuffle", shuffle); }, [shuffle]);
  useEffect(() => { lsSet("repeat", repeat); }, [repeat]);
  useEffect(() => { lsSet("darkMode", darkMode); if (user) userDataSave({ prefs: { darkMode, explicitFilter, audioQuality, sidebarOpen } }); }, [darkMode]);
  useEffect(() => { lsSet("sidebarOpen", sidebarOpen); }, [sidebarOpen]);
  useEffect(() => { lsSet("explicitFilter", explicitFilter); if (user) userDataSave({ prefs: { darkMode, explicitFilter, audioQuality, sidebarOpen } }); }, [explicitFilter]);
  useEffect(() => { lsSet("audioQuality", audioQuality); if (user) userDataSave({ prefs: { darkMode, explicitFilter, audioQuality, sidebarOpen } }); }, [audioQuality]);
  useEffect(() => { lsSet("crossfade", crossfade); }, [crossfade]);
  useEffect(() => { lsSet("showLyrics", showLyrics); }, [showLyrics]);
  useEffect(() => { lsSet("autoplay", autoplay); }, [autoplay]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const t = mediaSessionTrackRef.current;
      if (t) applyMediaMeta(t);
    }, 3000);
    return () => clearInterval(id);
  }, [playing]);

  useEffect(() => {
    ensureYT(); whenYT(initYT); loadHome();
    // Load dash.js for DASH stream playback (wolf API)
    if (!window.dashjs) {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/dashjs@4.5.0/dist/dash.all.min.js";
      document.head.appendChild(s);
    }
    // Handle Supabase OAuth callback — token arrives in URL hash
    const hash = window.location.hash;
    if (hash.includes("access_token=")) {
      const params = new URLSearchParams(hash.slice(1));
      const token = params.get("access_token");
      const email = params.get("email") || "";
      if (token) {
        setToken(token);
        const profile = getGoogleProfile();
        setUser({ id: getUserId(), ...profile });
        window.history.replaceState(null, "", window.location.pathname + window.location.search + "#/home/");
        loadPlaylists();
        loadUserData();
        toast(`✓ Signed in${profile?.name ? ` as ${profile.name}` : " with Google"}`);
      }
    }
  }, []);

  useEffect(() => {
    const handle = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") { e.preventDefault(); ytRef.current?.getPlayerState?.() === 1 ? ytRef.current.pauseVideo() : ytRef.current?.playVideo(); }
      if (e.code === "ArrowRight" && e.metaKey) advance(1);
      if (e.code === "ArrowLeft" && e.metaKey) advance(-1);
      if (e.code === "KeyL") { if (current) toggleLike(current); }
      if (e.code === "KeyS") setShuffle(s => !s);
      if (e.code === "KeyQ") setShowQueue(q => !q);
      if (e.code === "KeyB") setSidebarOpen(s => !s);
      if (e.code === "KeyF") setFullscreenOpen(f => !f); // NEW
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyK") { e.preventDefault(); setCmdOpen(c => !c); }
      if (e.code === "Comma") changeVol(Math.max(0, volRef.current - 10));
      if (e.code === "Period") changeVol(Math.min(100, volRef.current + 10));
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [current]);

  // Sleep timer
  useEffect(() => {
    clearTimeout(sleepRef.current);
    if (sleepMins) {
      sleepRef.current = setTimeout(() => {
        ytRef.current?.pauseVideo?.();
        setSleepMins(null);
        toast("💤 Sleep timer — paused");
      }, sleepMins * 60 * 1000);
    }
    return () => clearTimeout(sleepRef.current);
  }, [sleepMins]);

  // Accent tint from album art dominant color
  useEffect(() => {
    if (!current?.album?.cover_small) { setAccentColor(null); return; }
    const img = new Image(); img.crossOrigin = "anonymous";
    img.src = current.album.cover_small;
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 1;
        c.getContext("2d").drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = c.getContext("2d").getImageData(0, 0, 1, 1).data;
        if (Math.max(r, g, b) > 40 && r + g + b < 680) setAccentColor(`rgb(${r},${g},${b})`);
        else setAccentColor(null);
      } catch { setAccentColor(null); }
    };
  }, [current?.id]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accentColor || (darkMode ? "#3b82f6" : "#0070f3"));
    document.documentElement.style.setProperty("--accent-h", accentColor || (darkMode ? "#2563eb" : "#0060df"));
  }, [accentColor, darkMode]);

  const initYT = () => {
    if (ytRef.current) return;
    ytRef.current = new window.YT.Player("yt-mount", {
      height: "1", width: "1", videoId: "",
      playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, enablejsapi: 1, origin: window.location.origin },
      events: {
        onReady: e => e.target.setVolume(volRef.current),
        onStateChange: e => {
          const S = window.YT.PlayerState;
          if (e.data === S.PLAYING) {
            setPlaying(true); setBuffering(false);
            const cur = mediaSessionTrackRef.current || qRef.current[qIdxRef.current];
            if (cur) { [300, 600, 1000, 2000].forEach(ms => setTimeout(() => applyMediaMeta(cur), ms)); }
          }
          else if (e.data === S.PAUSED) {
            setPlaying(false);
            if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
          }
          else if (e.data === S.BUFFERING) { setBuffering(true); }
          else if (e.data === S.ENDED) {
            if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
            if (repeatRef.current) { e.target.seekTo(0); e.target.playVideo(); }
            else advance(1);
          }
        },
        onError: () => { setBuffering(false); advance(1); }
      }
    });
  };

  const mediaSessionTrackRef = useRef(null);

  const applyMediaMeta = (track) => {
    if (!("mediaSession" in navigator) || !track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || "Unknown Title",
      artist: track.artist?.name || "Unknown Artist",
      album: track.album?.title || "",
      artwork: [
        { src: track.album?.cover_small || "", sizes: "56x56", type: "image/jpeg" },
        { src: track.album?.cover_medium || "", sizes: "250x250", type: "image/jpeg" },
        { src: track.album?.cover_big || track.album?.cover_xl || "", sizes: "500x500", type: "image/jpeg" },
      ].filter(a => a.src),
    });
  };

  const setMediaSession = (track) => {
    if (!("mediaSession" in navigator)) return;
    mediaSessionTrackRef.current = track;
    applyMediaMeta(track);
    navigator.mediaSession.setActionHandler("play", () => ytRef.current?.playVideo?.());
    navigator.mediaSession.setActionHandler("pause", () => ytRef.current?.pauseVideo?.());
    navigator.mediaSession.setActionHandler("nexttrack", () => advance(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => advance(-1));
    navigator.mediaSession.setActionHandler("seekto", e => ytRef.current?.seekTo?.(e.seekTime, true));
  };

  const advance = (dir = 1) => {
    const q = qRef.current; if (!q.length) return;
    const n = shuffleRef.current ? Math.floor(Math.random() * q.length) : (qIdxRef.current + dir + q.length) % q.length;
    qIdxRef.current = n; setQIdx(n); doPlay(q[n], q, n);
  };

  const doPlay = async (track, list = [], idx = 0) => {
    setCurrent(track); setPlaying(false); setBuffering(true);
    if (list.length) { setQueue(list); setQIdx(idx); qRef.current = list; qIdxRef.current = idx; }
    setRecent(r => [track, ...r.filter(t => t.id !== track.id)].slice(0, 12));
    setMediaSession(track);
    // 1. Check YouTube cache
    let vid = await ytCacheGet(track.id);
    if (!vid) {
      // 2. Search YouTube
      const searchQ = audioQuality === "high" ? `${track.title} ${track.artist?.name} official audio` : `${track.title} ${track.artist?.name} audio`;
      vid = await ytSearch(searchQ);
      if (vid) ytCacheSet(track.id, track.artist?.name || "", track.title || "", vid);
    }
    if (vid) {
      tidalRef.current = null;
      // Pause wolf audio if playing
      const wolfAudio = document.getElementById("wolf-audio");
      if (wolfAudio) { wolfAudio.pause(); wolfAudio.src = ""; }
      if (ytRef.current?.loadVideoById) { ytRef.current.loadVideoById(vid); ytRef.current.setVolume(volRef.current); }
      else setTimeout(() => { ytRef.current?.loadVideoById?.(vid); ytRef.current?.setVolume?.(volRef.current); }, 900);
      return;
    }
    // 3. Wolf / Tidal stream fallback
    const wolfId = await wolfSearch(`${track.title} ${track.artist?.name || ""}`);
    if (wolfId) {
      const stream = await wolfStream(wolfId);
      if (stream) {
        toast("▶ Playing via Tidal");
        ytRef.current?.pauseVideo?.();
        const wolfAudio = document.getElementById("wolf-audio");
        if (stream.type === "dash" && window.dashjs) {
          const dp = window.dashjs.MediaPlayer().create();
          dp.initialize(wolfAudio, stream.url, true);
          dp.setVolume(volRef.current / 100);
        } else {
          wolfAudio.src = stream.url;
          wolfAudio.volume = volRef.current / 100;
          wolfAudio.play();
        }
        wolfAudio.onplay = () => { setPlaying(true); setBuffering(false); };
        wolfAudio.onpause = () => setPlaying(false);
        wolfAudio.onended = () => advance(1);
        wolfAudio.onerror = () => { setBuffering(false); toast("⚠ Tidal stream failed"); };
        setBuffering(false); setPlaying(true);
        return;
      }
    }
    // 4. Deezer 30s preview last resort
    if (track.preview) {
      toast("⚠ Full audio unavailable — playing 30s preview");
      const audio = new Audio(`${CORS}${encodeURIComponent(track.preview)}`);
      audio.volume = volRef.current / 100;
      audio.play().then(() => { setPlaying(true); setBuffering(false); }).catch(() => {
        setBuffering(false); toast("⚠ Could not play preview");
      });
      return;
    }
    setBuffering(false); toast("⚠ No audio source found for this track");
  };

  const togglePlay = useCallback(() => {
    const wolfAudio = document.getElementById("wolf-audio");
    if (wolfAudio && wolfAudio.src && !wolfAudio.paused) { wolfAudio.pause(); return; }
    if (wolfAudio && wolfAudio.src && wolfAudio.paused) { wolfAudio.play(); return; }
    if (!ytRef.current) return;
    playing ? ytRef.current.pauseVideo() : ytRef.current.playVideo();
  }, [playing]);
  const handleSeek = useCallback((t) => { ytRef.current?.seekTo?.(t, true); }, []);
  const changeVol = useCallback(v => {
    setVolume(v); volRef.current = v;
    ytRef.current?.setVolume?.(v);
    const wolfAudio = document.getElementById("wolf-audio");
    if (wolfAudio) wolfAudio.volume = v / 100;
  }, []);
  const toggleLike = useCallback(t => {
    if (!user) { setAuthOpen(true); toast("Sign in to save tracks"); return; }
    setLiked(p => {
      const wasLiked = p.some(x => x.id === t.id);
      toast(wasLiked ? "Removed from saved" : "♥ Saved to library");
      return wasLiked ? p.filter(x => x.id !== t.id) : [...p, t];
    });
  }, [user]);

  const toast = useCallback((msg) => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  }, []);

  const loadHome = async () => {
    setLoading(true);
    try {
      const [c, g] = await Promise.all([dz("/chart/0/tracks?limit=20"), dz("/genre")]);
      setCharts(c.data || []);
      setGenres((g.data || []).filter(x => x.id !== 0).slice(0, 12));
      const ed = await dz("/editorial/0/charts");
      setFeatured(ed.albums?.data?.slice(0, 10) || []);
    } catch { toast("⚠ Could not load data. Check CORS proxy."); }
    setLoading(false);
  };

  const doSearch = async e => {
    e?.preventDefault(); if (!query.trim()) return;
    setLoading(true); setView("search");
    try {
      const [tr, ar, al, pl] = await Promise.all([
        dz(`/search/track?q=${encodeURIComponent(query)}&limit=15`),
        dz(`/search/artist?q=${encodeURIComponent(query)}&limit=6`),
        dz(`/search/album?q=${encodeURIComponent(query)}&limit=6`),
        dz(`/search/playlist?q=${encodeURIComponent(query)}&limit=6`),
      ]);
      setResults({ tracks: tr.data || [], artists: ar.data || [], albums: al.data || [], playlists: pl.data || [] });
    } catch {}
    setLoading(false);
  };

  const openPlaylist = async p => { setSelPl(p); setView("playlist"); setLoading(true); const d = await dz(`/playlist/${p.id}/tracks?limit=50`); setPlTracks(d.data || []); setLoading(false); };
  const openAlbum = async a => { setSelAlb(a); setView("album"); setLoading(true); const d = await dz(`/album/${a.id}/tracks`); setAlbTracks(d.data || []); setLoading(false); };
  const openArtist = async a => { setView("artist"); setLoading(true); const [i, t, alb] = await Promise.all([dz(`/artist/${a.id}`), dz(`/artist/${a.id}/top?limit=10`), dz(`/artist/${a.id}/albums?limit=10`)]); setArtist({ info: i, top: t.data || [], albums: alb.data || [] }); setLoading(false); };
  const openGenre = async g => { setSelGenre(g); setView("genre"); setLoading(true); const d = await dz(`/chart/${g.id}/tracks?limit=20`); setGenTracks(d.data || []); setLoading(false); };

  // Related tracks = current queue or search results or charts
  const handleSleep = useCallback(() => {
    const opts = [15, 30, 45, 60];
    const next = sleepMins ? opts[(opts.indexOf(sleepMins) + 1) % opts.length] : opts[0];
    if (sleepMins && opts.indexOf(sleepMins) === opts.length - 1) { setSleepMins(null); toast("Sleep timer off"); }
    else { setSleepMins(next); toast(`💤 Sleep in ${next} min`); }
  }, [sleepMins]);

  const signOut = async () => {
    await sbSignOut();
    // Clear all wave_ localStorage keys
    Object.keys(localStorage).filter(k => k.startsWith("wave_")).forEach(k => localStorage.removeItem(k));
    setUser(null); setPlaylists([]); setPublicPlaylists([]);
    setLiked([]); setRecent([]);
    toast("Signed out");
    window.location.href = "/";
  };

  const downloadPreview = useCallback(async (track) => {
    if (!user) { setAuthOpen(true); toast("Sign in to download previews"); return; }
    if (!track.preview) { toast("⚠ No preview available for this track"); return; }
    toast("⬇ Preparing 30s preview…");
    try {
      // Fetch through CORS proxy so we get the raw bytes, not a browser-played stream
      const r = await fetch(`${CORS}${encodeURIComponent(track.preview)}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(new Blob([blob], { type: "audio/mpeg" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${track.artist?.name} - ${track.title} (30s preview).mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast("✓ Downloaded — 30 second preview only");
    } catch { toast("⚠ Download failed"); }
  }, [user]);

  // Load playlists from Supabase
  const loadPlaylists = useCallback(async () => {
    const [own, pub] = await Promise.all([plGet(), plGetPublic()]);
    setPlaylists(own);
    setPublicPlaylists(pub);
  }, []);
  useEffect(() => { loadPlaylists(); }, []);

  const createPlaylist = async () => {
    if (!newPlName.trim()) return;
    await plCreate(newPlName.trim(), newPlPublic);
    setNewPlName(""); setNewPlPublic(false); setShowCreatePl(false);
    loadPlaylists(); toast(`✓ Playlist created${newPlPublic ? " (public)" : ""}`);
  };

  const loadUserData = useCallback(async () => {
    const d = await userDataGet();
    if (!d) return;
    if (Array.isArray(d.liked) && d.liked.length) setLiked(d.liked);
    if (Array.isArray(d.recent) && d.recent.length) setRecent(d.recent);
    if (d.prefs) {
      if (d.prefs.darkMode != null) setDarkMode(d.prefs.darkMode);
      if (d.prefs.explicitFilter != null) setExplicitFilter(d.prefs.explicitFilter);
      if (d.prefs.audioQuality != null) setAudioQuality(d.prefs.audioQuality);
    }
  }, []);
  const deletePlaylist = async (id) => {
    await plDelete(id); loadPlaylists(); toast("Playlist deleted");
    if (selCustomPl?.id === id) { setSelCustomPl(null); setCustomPlTracks([]); setView("library"); }
  };
  const addToPlaylist = async (playlistId, track) => {
    await plAddTrack(playlistId, track); toast("✓ Added to playlist");
    if (selCustomPl?.id === playlistId) openCustomPlaylist(selCustomPl);
  };
  const removeFromPlaylist = async (track) => {
    await plRemoveTrack(selCustomPl.id, track.id); openCustomPlaylist(selCustomPl); toast("Removed from playlist");
  };
  const openCustomPlaylist = async (pl) => {
    setSelCustomPl(pl); setView("custom_playlist"); setLoading(true);
    const tracks = await plGetTracks(pl.id);
    setCustomPlTracks(tracks); setLoading(false);
  };

  // Similar tracks
  const getSimilar = async (track) => {
    if (!track) return;
    setSimilarLoading(true); setSimilar([]);
    setView("similar");
    const cached = await similarGet(track.id);
    if (cached) { setSimilar(cached); setSimilarLoading(false); return; }
    try {
      // Try track radio first, fall back to artist radio
      let tracks = [];
      const d = await dz(`/track/${track.id}/radio?limit=20`);
      tracks = Array.isArray(d?.data) ? d.data : [];
      if (!tracks.length && track.artist?.id) {
        const d2 = await dz(`/artist/${track.artist.id}/radio?limit=20`);
        tracks = Array.isArray(d2?.data) ? d2.data : [];
      }
      // Filter out the source track
      tracks = tracks.filter(t => t.id !== track.id);
      setSimilar(tracks);
      if (tracks.length) similarSet(track.id, tracks);
      else toast("⚠ No similar tracks found");
    } catch (err) {
      toast("⚠ Could not load similar tracks");
    }
    setSimilarLoading(false);
  };

  const relatedTracks = (results?.tracks || charts).filter(t => t.id !== current?.id).slice(0, 30);

  const tp = {
    explicitFilter, currentId: current?.id, playing, buffering, liked,
    onPlay: doPlay, onLike: toggleLike,
    onSimilar: getSimilar,
    onDownload: downloadPreview,
    onAddToPlaylist: (track, e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setAddToPlMenu({ track, x: rect.left, y: rect.bottom + 4 });
    },
  };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div id="yt-mount" />
      <audio id="wolf-audio" crossOrigin="anonymous" style={{ display: "none" }} onEnded={() => advance(1)} />

      {/* TOASTS */}
      <div className="toast-area">
        {toasts.map(t => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>

      {/* COMMAND PALETTE */}
      {cmdOpen && (
        <CommandPalette
          onClose={() => setCmdOpen(false)}
          recent={recent}
          liked={liked}
          charts={charts}
          queue={queue}
          current={current}
          onPlay={doPlay}
          onNav={v => { setView(v); setCmdOpen(false); }}
          onAction={a => {
            if (a === "fullscreen") setFullscreenOpen(f => !f);
            if (a === "shuffle") setShuffle(s => !s);
            if (a === "darkmode") setDarkMode(d => !d);
            if (a === "sleep") handleSleep();
            if (a === "lyrics") { setView("lyrics"); }
          }}
        />
      )}

      {/* LYRICS */}
      {/* AUTH MODAL */}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}

      {/* CREATE PLAYLIST MODAL */}
      {showCreatePl && (
        <div className="pl-modal-backdrop" onClick={() => setShowCreatePl(false)}>
          <div className="pl-modal" onClick={e => e.stopPropagation()}>
            <div className="pl-modal-title">New Playlist</div>
            <input className="pl-modal-input" placeholder="Playlist name…" value={newPlName} onChange={e => setNewPlName(e.target.value)} onKeyDown={e => e.key === "Enter" && createPlaylist()} autoFocus />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontFamily: "'Geist Mono',monospace", color: "var(--tx3)" }}>{newPlPublic ? "Public — anyone can see this" : "Private — only you"}</span>
              <Toggle checked={newPlPublic} onChange={setNewPlPublic} />
            </div>
            <div className="pl-modal-btns">
              <button className="pl-modal-btn" onClick={() => { setShowCreatePl(false); setNewPlName(""); setNewPlPublic(false); }}>Cancel</button>
              <button className="pl-modal-btn primary" onClick={createPlaylist}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD TO PLAYLIST CONTEXT MENU */}
      {addToPlMenu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => setAddToPlMenu(null)} />
          <div className="add-to-pl-menu" style={{ top: addToPlMenu.y, left: addToPlMenu.x, zIndex: 200 }}>
            {playlists.length === 0
              ? <div className="add-to-pl-item" style={{ color: "var(--tx3)", cursor: "default" }}>No playlists — create one first</div>
              : playlists.map(pl => (
                <div key={pl.id} className="add-to-pl-item" onClick={() => { addToPlaylist(pl.id, addToPlMenu.track); setAddToPlMenu(null); }}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
                  {pl.name}
                </div>
              ))}
          </div>
        </>
      )}

      {/* FULLSCREEN */}
      {fullscreenOpen && (
        <FullscreenView
          current={current}
          queue={queue}
          qIdx={qIdx}
          playing={playing}
          buffering={buffering}
          shuffle={shuffle}
          repeat={repeat}
          liked={liked}
          volume={volume}
          ytRef={ytRef}
          relatedTracks={relatedTracks}
          onClose={() => setFullscreenOpen(false)}
          onTogglePlay={togglePlay}
          onAdvance={advance}
          onSeek={handleSeek}
          onVolume={changeVol}
          onLike={toggleLike}
          onShuffle={() => { setShuffle(s => { toast(!s ? "Shuffle on" : "Shuffle off"); return !s; }); }}
          onRepeat={() => { setRepeat(r => { toast(!r ? "Repeat on" : "Repeat off"); return !r; }); }}
          onPlayFromQueue={(t, i) => { qIdxRef.current = i; setQIdx(i); doPlay(t, queue, i); }}
        />
      )}

      {/* QUEUE PANEL */}
      {showQueue && (
        <>
          <div className="queue-overlay" onClick={() => setShowQueue(false)} />
          <div className="queue-panel">
            <div className="queue-hd">
              <span className="queue-title">Queue · <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: 12, color: "var(--tx3)" }}>{queue.length} tracks</span></span>
              <button className="icon-btn" onClick={() => setShowQueue(false)}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="queue-body">
              {queue.length === 0 ? <div className="empty"><div className="empty-sub">queue is empty</div></div>
                : queue.map((t, i) => (
                  <div key={`${t.id}-${i}`} className={`queue-item${i === qIdx ? " current" : ""}`} onClick={() => { qIdxRef.current = i; setQIdx(i); doPlay(t, queue, i); }}>
                    <span className="queue-num">{i === qIdx && playing ? <div className="eq"><div className="eq-b" /><div className="eq-b" /><div className="eq-b" /></div> : i + 1}</span>
                    <img src={t.album?.cover_small || ""} alt="" />
                    <div className="queue-item-meta">
                      <div className={`queue-item-name${i === qIdx ? " active" : ""}`}>{t.title}</div>
                      <div className="queue-item-sub">{t.artist?.name}</div>
                    </div>
                    <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: 10, color: "var(--tx3)", flexShrink: 0 }}>{fmt(t.duration)}</span>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}

      <div className={`shell${sidebarOpen ? "" : " nav-collapsed"}`}>
        {/* SIDEBAR */}
        <nav className="nav">
          <div className="nav-inner">
            <div className="nav-header">
              <div className="logo">
                <WaveLogo size={18} />
                <span className="logo-word">WAVE</span>
              </div>
            </div>
            <div className="nav-body">
              <div className="nav-section">
                <div className="nav-section-label">Pages</div>
                {[
                  { v: "home", label: "Overview", ico: <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg> },
                  { v: "browse", label: "Browse", ico: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg> },
                  { v: "liked", label: "Saved", ico: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg> },
                  { v: "library", label: "Library", ico: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg> },
                  { v: "stats", label: "Stats", ico: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6" /></svg> },
                  { v: "lyrics", label: "Lyrics", ico: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg> },
                  { v: "settings", label: "Settings", ico: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg> },
                ].map(n => (
                  <div key={n.v} className={`nav-item${view === n.v ? " active" : ""}`} onClick={() => setView(n.v)}>
                    {n.ico} {n.label}
                    {n.v === "liked" && liked.length > 0 && <span className="badge">{liked.length}</span>}
                    {n.v === "settings" && explicitFilter && <span className="badge" style={{ color: "var(--yellow)", borderColor: "var(--yellow)" }}>E</span>}
                  </div>
                ))}
              </div>
              <div className="nav-section">
                <div className="nav-section-label">Library</div>
                {liked.length === 0
                  ? <div style={{ padding: "6px 16px", fontSize: 11, color: "var(--tx3)", fontFamily: "'Geist Mono',monospace" }}>empty</div>
                  : liked.slice(0, 10).map(t => (
                    <div key={t.id} className="nav-lib-track" onClick={() => doPlay(t)}>
                      <img src={t.album?.cover_small || ""} alt="" />
                      <span>{t.title}</span>
                      {current?.id === t.id && playing && <div className="eq" style={{ marginLeft: "auto", flexShrink: 0 }}><div className="eq-b" /><div className="eq-b" /><div className="eq-b" /></div>}
                    </div>
                  ))}
              </div>
            </div>
            {current && (
              <div className="nav-now-playing">
                <div className="nav-now-label">Now Playing</div>
                <div className="nav-now-info">
                  <img className="nav-now-img" src={current.album?.cover_small || ""} alt="" />
                  <div style={{ overflow: "hidden" }}>
                    <div className="nav-now-title">{current.title}</div>
                    <div className="nav-now-artist">{current.artist?.name}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </nav>

        {/* MAIN */}
        <main className="main">
          <div className="topbar">
            <div className="topbar-left">
              <button className="icon-btn sidebar-toggle-btn" onClick={() => setSidebarOpen(s => !s)} title="Toggle sidebar (B)">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></svg>
              </button>
              <button className="icon-btn" onClick={() => setView("home")}>
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
              </button>
            </div>
            <form className="srch-form" onSubmit={doSearch}>
              <svg className="srch-ic" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <input className="srch-in" placeholder="Search tracks, artists, albums…" value={query} onChange={e => setQuery(e.target.value)} />
            </form>
            <div className="topbar-right">
              {explicitFilter && <span className="chip warn">E filter on</span>}
              {buffering && <span className="chip">buffering…</span>}
              {playing && !buffering && <span className="chip live">● live</span>}
              {sleepMins && <span className="chip" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>💤 {sleepMins}m</span>}
              <button className="icon-btn" title="Command palette (⌘K)" onClick={() => setCmdOpen(c => !c)}>
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" /></svg>
              </button>
              <button className="icon-btn" title="Lyrics" onClick={() => setView("lyrics")}>
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
              </button>
              <button className="icon-btn sleep-btn" title="Sleep timer" onClick={handleSleep}>
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 6v6l4 2"/></svg>
                {sleepMins && <span className="sleep-badge">{sleepMins}</span>}
              </button>
              <button className="icon-btn" title="Queue (Q)" onClick={() => setShowQueue(q => !q)}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
              </button>
              <button className="icon-btn" onClick={() => setDarkMode(d => !d)} title="Toggle dark mode">
                {darkMode
                  ? <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" /></svg>
                  : <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>}
              </button>
              {user
                ? <>
                    <button
                      className="user-chip"
                      ref={userChipRef}
                      onClick={() => setShowUserMenu(m => !m)}
                    >
                      {user.avatar
                        ? <img src={user.avatar} style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} alt="" />
                        : <div className="user-avatar">{(user.name?.[0] || user.email?.[0] || "U").toUpperCase()}</div>}
                      {user.name || user.email?.split("@")[0] || "me"}
                      <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ opacity: .5 }}><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    {showUserMenu && (() => {
                      const rect = userChipRef.current?.getBoundingClientRect();
                      return <>
                        <div style={{ position: "fixed", inset: 0, zIndex: 299 }} onClick={() => setShowUserMenu(false)} />
                        <div className="user-dropdown" style={{ top: (rect?.bottom || 40) + 6, right: 12 }}>
                          <div className="user-dropdown-header">
                            {user.avatar
                              ? <img className="user-dropdown-avatar" src={user.avatar} alt="" />
                              : <div className="user-dropdown-avatar-ph">{(user.name?.[0] || "U").toUpperCase()}</div>}
                            <div style={{ overflow: "hidden" }}>
                              <div className="user-dropdown-name">{user.name || "WAVE User"}</div>
                              <div className="user-dropdown-email">{user.email}</div>
                            </div>
                          </div>
                          {[
                            { label: "Library", icon: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg>, action: () => { setView("library"); setShowUserMenu(false); } },
                            { label: "Saved tracks", icon: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>, action: () => { setView("liked"); setShowUserMenu(false); } },
                            { label: "Stats", icon: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>, action: () => { setView("stats"); setShowUserMenu(false); } },
                            { label: "Settings", icon: <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>, action: () => { setView("settings"); setShowUserMenu(false); } },
                          ].map(item => (
                            <div key={item.label} className="user-dropdown-item" onClick={item.action}>
                              {item.icon}{item.label}
                            </div>
                          ))}
                          <div style={{ borderTop: "var(--line)", marginTop: 2 }} />
                          <div className="user-dropdown-item danger" onClick={() => { signOut(); setShowUserMenu(false); }}>
                            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
                            Sign out
                          </div>
                        </div>
                      </>;
                    })()}
                  </>
                : <button className="icon-btn" title="Sign in" onClick={() => setAuthOpen(true)}>
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                  </button>}
            </div>
          </div>

          {loading && <div className="ld"><svg className="spin" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>fetching data…</div>}

          {!loading && view === "home" && (
            <div>
              <div className="ph">
                <div className="pt">Overview</div>
                <div className="ps">wave · deezer api · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</div>
              </div>
              {recent.length > 0 && (
                <div className="sec">
                  <div className="sec-hd"><span className="sec-lbl">Recently Played</span></div>
                  <div className="recent-strip">
                    {recent.map(t => (
                      <div key={t.id} className="recent-item" onClick={() => doPlay(t)}>
                        <img src={t.album?.cover_medium || t.album?.cover_small || ""} alt="" />
                        <div><div className="recent-item-name">{t.title}</div><div className="recent-item-sub">{t.artist?.name}</div></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="sec">
                <div className="sec-hd"><span className="sec-lbl">Top Charts</span><span className="sec-act" onClick={() => setView("browse")}>browse →</span></div>
                <TTable tracks={charts.slice(0, 10)} {...tp} />
              </div>
              <div className="sec">
                <div className="sec-hd"><span className="sec-lbl">Genres</span></div>
                <div className="ggrid">
                  {genres.map(g => (
                    <div key={g.id} className="gcel" onClick={() => openGenre(g)}>
                      <div className="gcel-name">{g.name}</div>
                      {g.picture_medium && <img className="gcel-img" src={g.picture_medium} alt="" />}
                    </div>
                  ))}
                </div>
              </div>
              {featured.length > 0 && (
                <div className="sec">
                  <div className="sec-hd"><span className="sec-lbl">Featured Albums</span></div>
                  <CardGrid items={featured} onClick={openAlbum} imgFn={a => a.cover_medium || a.cover} titleFn={a => a.title} subFn={a => a.artist?.name || ""} />
                </div>
              )}
            </div>
          )}

          {!loading && view === "search" && results && (
            <div>
              <div className="ph"><div className="pt">Search Results</div><div className="ps">"{query}" · {(results.tracks?.length || 0) + (results.artists?.length || 0) + (results.albums?.length || 0)} results</div></div>
              {results.tracks?.length > 0 && <div className="sec"><div className="sec-hd"><span className="sec-lbl">Tracks <span style={{ color: "var(--tx4)", marginLeft: 4 }}>{results.tracks.length}</span></span></div><TTable tracks={results.tracks} {...tp} /></div>}
              {results.artists?.length > 0 && <div className="sec"><div className="sec-hd"><span className="sec-lbl">Artists</span></div><CardGrid items={results.artists} onClick={openArtist} imgFn={a => a.picture_medium || a.picture} titleFn={a => a.name} subFn={a => fmtBig(a.nb_fan) + " fans"} round /></div>}
              {results.albums?.length > 0 && <div className="sec"><div className="sec-hd"><span className="sec-lbl">Albums</span></div><CardGrid items={results.albums} onClick={openAlbum} imgFn={a => a.cover_medium || a.cover} titleFn={a => a.title} subFn={a => a.artist?.name || ""} /></div>}
              {results.playlists?.length > 0 && <div className="sec"><div className="sec-hd"><span className="sec-lbl">Playlists</span></div><CardGrid items={results.playlists} onClick={openPlaylist} imgFn={p => p.picture_medium || p.picture} titleFn={p => p.title} subFn={p => p.nb_tracks + " tracks"} /></div>}
            </div>
          )}

          {!loading && view === "liked" && (
            <div>
              <div className="ph"><div className="pt">Saved Tracks</div><div className="ps">{liked.length} tracks saved</div></div>
              {liked.length === 0 ? <div className="empty"><div className="empty-title">Nothing saved yet</div><div className="empty-sub">Press L or click ♥ on any track</div></div> : <TTable tracks={liked} {...tp} />}
            </div>
          )}

          {!loading && view === "stats" && <StatsPage recent={recent} liked={liked} />}

          {view === "lyrics" && <LyricsPage current={current} ytRef={ytRef} />}

          {/* LIBRARY — custom playlists */}
          {view === "library" && (
            <div>
              <div className="ph" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div className="pt">Library</div>
                  <div className="ps">{libTab === "mine" ? `${playlists.length} playlists` : `${publicPlaylists.length} public playlists`}{!user && libTab === "mine" ? " · sign in to create" : ""}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ position: "relative" }}>
                    <svg style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--tx3)", pointerEvents: "none" }} width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <input style={{ paddingLeft: 26, paddingRight: 10, height: 28, background: "var(--bg3)", border: "var(--line)", borderRadius: "var(--r)", fontSize: 12, fontFamily: "'Geist',sans-serif", color: "var(--tx)", outline: "none", width: 160 }} placeholder="Search playlists…" value={plSearch} onChange={e => setPlSearch(e.target.value)} />
                  </div>
                  {user && libTab === "mine" && <button className="pl-create-btn" onClick={() => setShowCreatePl(true)}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                    New
                  </button>}
                  {!user && <button className="pl-create-btn" onClick={() => setAuthOpen(true)}>Sign in</button>}
                </div>
              </div>
              {/* Tabs */}
              <div style={{ display: "flex", borderBottom: "var(--line)", padding: "0 18px", background: "var(--bg2)" }}>
                {[["mine", "My Playlists"], ["public", "Public"]].map(([id, label]) => (
                  <div key={id} style={{ fontFamily: "'Geist Mono',monospace", fontSize: 10, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: libTab === id ? "var(--tx)" : "var(--tx3)", padding: "10px 12px", cursor: "pointer", borderBottom: libTab === id ? "2px solid var(--tx)" : "2px solid transparent", marginBottom: -1, transition: "all .1s" }} onClick={() => setLibTab(id)}>{label}</div>
                ))}
              </div>
              {(() => {
                const src = libTab === "mine" ? playlists : publicPlaylists;
                const filtered = src.filter(pl => !plSearch || pl.name.toLowerCase().includes(plSearch.toLowerCase()));
                if (filtered.length === 0) return (
                  <div className="empty">
                    <div className="empty-title">{plSearch ? `No playlists matching "${plSearch}"` : libTab === "mine" ? "No playlists yet" : "No public playlists"}</div>
                    <div className="empty-sub">{libTab === "mine" && !user ? "Sign in to create playlists" : libTab === "mine" ? "Create one to organise your music" : "Public playlists from all users appear here"}</div>
                  </div>
                );
                return (
                  <div className="cgrid">
                    {filtered.map(pl => (
                      <div key={pl.id} className="pl-card gc" onClick={() => openCustomPlaylist(pl)}>
                        {pl.cover_url
                          ? <img className="gc-img" src={pl.cover_url} alt="" style={{ width: "100%", aspectRatio: 1, objectFit: "cover", borderRadius: "var(--r2)", marginBottom: 10, border: "var(--line)", display: "block" }} />
                          : <div className="pl-card-icon gc-img" style={{ aspectRatio: 1 }}>
                              <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
                            </div>}
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <div className="pl-card-title" style={{ flex: 1 }}>{pl.name}</div>
                          <span style={{ fontFamily: "'Geist Mono',monospace", fontSize: 9, fontWeight: 600, letterSpacing: ".06em", color: pl.is_public ? "var(--green)" : "var(--tx3)", border: `1px solid ${pl.is_public ? "var(--green)" : "var(--border)"}`, borderRadius: 3, padding: "1px 4px", flexShrink: 0 }}>{pl.is_public ? "PUB" : "PRV"}</span>
                        </div>
                        <div className="pl-card-sub">{pl.playlist_tracks?.[0]?.count ?? 0} tracks</div>
                        {user && pl.user_id === user.id && <button className="pl-card-delete" onClick={e => { e.stopPropagation(); deletePlaylist(pl.id); }}>
                          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* CUSTOM PLAYLIST detail */}
          {!loading && view === "custom_playlist" && selCustomPl && (
            <div>
              <div className="ehero">
                <div className="ehero-img-cell" style={{ background: "var(--bg3)" }}>
                  {selCustomPl.cover_url
                    ? <img className="ehero-img" src={selCustomPl.cover_url} alt="" />
                    : <svg width="48" height="48" fill="none" stroke="var(--tx3)" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>}
                </div>
                <div className="ehero-info">
                  <div className="entity-type">Playlist</div>
                  <div className="entity-name">{selCustomPl.name}</div>
                  <div className="entity-meta"><span className="emeta-item"><span className="lbl">tracks</span>{customPlTracks.length}</span></div>
                  <button className="play-hero-btn" onClick={() => customPlTracks.length && doPlay(customPlTracks[0], customPlTracks, 0)}>
                    <svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg> Play All
                  </button>
                </div>
              </div>
              <div style={{ padding: "8px 18px" }}><button className="back-btn" onClick={() => setView("library")}>← library</button></div>
              <TTable tracks={customPlTracks} showAlbum {...tp} />
            </div>
          )}

          {/* SIMILAR TRACKS */}
          {view === "similar" && (
            <div>
              <div className="ph" style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "column" }}>
                <button className="back-btn" onClick={() => window.history.back()}>← back</button>
                <div className="pt">Similar to {current?.title}</div>
                <div className="ps">{current?.artist?.name} · tracks you might like</div>
              </div>
              {similarLoading && <div className="ld"><svg className="spin" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>finding similar tracks…</div>}
              {!similarLoading && similar.length === 0 && <div className="empty"><div className="empty-title">No similar tracks found</div><div className="empty-sub">Try a more popular track</div></div>}
              {!similarLoading && similar.length > 0 && <TTable tracks={similar} {...tp} />}
            </div>
          )}

          {!loading && view === "browse" && (
            <div>
              <div className="ph"><div className="pt">Browse</div><div className="ps">genres & moods</div></div>
              <div className="sec"><div className="sec-hd"><span className="sec-lbl">All Genres</span></div>
                <div className="ggrid">{genres.map(g => <div key={g.id} className="gcel" onClick={() => openGenre(g)}><div className="gcel-name">{g.name}</div>{g.picture_medium && <img className="gcel-img" src={g.picture_medium} alt="" />}</div>)}</div>
              </div>
            </div>
          )}

          {!loading && view === "genre" && selGenre && (
            <div>
              <div className="ph" style={{ display: "flex", alignItems: "flex-start", flexDirection: "column", gap: 8 }}>
                <button className="back-btn" onClick={() => setView("browse")}>← back</button>
                <div className="pt">{selGenre.name}</div>
                <div className="ps">top {genTracks.length} tracks</div>
              </div>
              <TTable tracks={genTracks} {...tp} />
            </div>
          )}

          {!loading && view === "playlist" && selPl && (
            <div>
              <div className="ehero">
                <div className="ehero-img-cell"><img className="ehero-img" src={selPl.picture_big || selPl.picture_medium} alt="" /></div>
                <div className="ehero-info">
                  <div className="entity-type">Playlist</div>
                  <div className="entity-name">{selPl.title}</div>
                  <div className="entity-meta">
                    <span className="emeta-item"><span className="lbl">tracks</span>{plTracks.length}</span>
                    {selPl.fans && <span className="emeta-item"><span className="lbl">fans</span>{fmtBig(selPl.fans)}</span>}
                  </div>
                  <button className="play-hero-btn" onClick={() => plTracks.length && doPlay(plTracks[0], plTracks, 0)}>
                    <svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg> Play All
                  </button>
                </div>
              </div>
              <div style={{ padding: "8px 18px" }}><button className="back-btn" onClick={() => setView("search")}>← back</button></div>
              <TTable tracks={plTracks} {...tp} />
            </div>
          )}

          {!loading && view === "album" && selAlb && (
            <div>
              <div className="ehero">
                <div className="ehero-img-cell"><img className="ehero-img" src={selAlb.cover_big || selAlb.cover_medium} alt="" /></div>
                <div className="ehero-info">
                  <div className="entity-type">Album</div>
                  <div className="entity-name">{selAlb.title}</div>
                  <div className="entity-meta">
                    <span className="emeta-item"><span className="lbl">artist</span>{selAlb.artist?.name}</span>
                    <span className="emeta-item"><span className="lbl">tracks</span>{albTracks.length}</span>
                    {selAlb.release_date && <span className="emeta-item"><span className="lbl">year</span>{selAlb.release_date.slice(0, 4)}</span>}
                  </div>
                  <button className="play-hero-btn" onClick={() => albTracks.length && doPlay({ ...albTracks[0], album: selAlb }, albTracks.map(t => ({ ...t, album: selAlb })), 0)}>
                    <svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg> Play All
                  </button>
                </div>
              </div>
              <div style={{ padding: "8px 18px" }}><button className="back-btn" onClick={() => setView("search")}>← back</button></div>
              <TTable tracks={albTracks.map(t => ({ ...t, album: selAlb }))} showAlbum={false} {...tp} />
            </div>
          )}

          {!loading && view === "artist" && artist && (
            <div>
              <div className="ehero">
                <div className="ehero-img-cell"><img className="ehero-img round" src={artist.info?.picture_big || artist.info?.picture_medium} alt="" /></div>
                <div className="ehero-info">
                  <div className="entity-type">Artist</div>
                  <div className="entity-name">{artist.info?.name}</div>
                  <div className="entity-meta">
                    <span className="emeta-item"><span className="lbl">fans</span>{fmtBig(artist.info?.nb_fan)}</span>
                    <span className="emeta-item"><span className="lbl">albums</span>{artist.albums?.length}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <button className="play-hero-btn" onClick={() => artist.top.length && doPlay(artist.top[0], artist.top, 0)}>
                      <svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg> Play Top Tracks
                    </button>
                    <button className="similar-btn" onClick={() => artist.top[0] && getSimilar(artist.top[0])}>
                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3a9 9 0 0 1 9 9M3 12a9 9 0 0 1 9-9" /></svg> Similar
                    </button>
                  </div>
                </div>
              </div>
              <div style={{ padding: "8px 18px" }}><button className="back-btn" onClick={() => setView("search")}>← back</button></div>
              <div className="sec"><div className="sec-hd"><span className="sec-lbl">Popular</span></div><TTable tracks={artist.top} {...tp} /></div>
              {artist.albums?.length > 0 && <div className="sec">
                <div className="sec-hd"><span className="sec-lbl">Discography <span style={{ color: "var(--tx3)" }}>{artist.albums.length}</span></span></div>
                <CardGrid items={artist.albums} onClick={openAlbum} imgFn={a => a.cover_medium} titleFn={a => a.title} subFn={a => a.release_date?.slice(0, 4) || ""} />
              </div>}
            </div>
          )}

          {!loading && view === "settings" && (
            <div>
              <div className="ph"><div className="pt">Settings</div><div className="ps">preferences & configuration</div></div>
              <div className="sec">
                <div className="sec-hd"><span className="sec-lbl">Playback</span></div>
                <div className="settings-grid">
                  <div className="setting-card">
                    <div className="setting-card-title">Explicit Content Filter</div>
                    <div className="setting-card-desc">Hide tracks marked as explicit. Tracks with the E badge will be removed from all lists.</div>
                    <div className="toggle-wrap">
                      <span style={{ fontSize: 12, fontFamily: "'Geist Mono',monospace", color: explicitFilter ? "var(--yellow)" : "var(--tx3)" }}>{explicitFilter ? "Filter ON" : "Filter OFF"}</span>
                      <Toggle checked={explicitFilter} onChange={v => { setExplicitFilter(v); toast(v ? "🔒 Explicit filter enabled" : "Explicit filter disabled"); }} />
                    </div>
                  </div>
                  <div className="setting-card">
                    <div className="setting-card-title">Search Quality</div>
                    <div className="setting-card-desc">Controls how WAVE searches YouTube for audio. High quality uses more specific queries.</div>
                    <select className="setting-select" value={audioQuality} onChange={e => { setAudioQuality(e.target.value); toast("Quality set to " + e.target.value); }}>
                      <option value="high">High — official audio priority</option>
                      <option value="standard">Standard — any audio match</option>
                    </select>
                  </div>
                  <div className="setting-card">
                    <div className="setting-card-title">Autoplay</div>
                    <div className="setting-card-desc">Automatically continue to the next track in queue when the current one ends.</div>
                    <div className="toggle-wrap">
                      <span style={{ fontSize: 12, fontFamily: "'Geist Mono',monospace", color: "var(--tx3)" }}>{autoplay ? "Enabled" : "Disabled"}</span>
                      <Toggle checked={autoplay} onChange={v => { setAutoplay(v); toast(v ? "Autoplay enabled" : "Autoplay disabled"); }} />
                    </div>
                  </div>
                  <div className="setting-card">
                    <div className="setting-card-title">Crossfade</div>
                    <div className="setting-card-desc">Smooth transition between tracks. (Visual indicator only — YouTube API limitation.)</div>
                    <div className="toggle-wrap">
                      <span style={{ fontSize: 12, fontFamily: "'Geist Mono',monospace", color: "var(--tx3)" }}>{crossfade ? "Enabled" : "Disabled"}</span>
                      <Toggle checked={crossfade} onChange={v => { setCrossfade(v); toast(v ? "Crossfade enabled" : "Crossfade disabled"); }} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="sec">
                <div className="sec-hd"><span className="sec-lbl">Appearance</span></div>
                <div className="settings-grid">
                  <div className="setting-card">
                    <div className="setting-card-title">Dark Mode</div>
                    <div className="setting-card-desc">Switch between light and dark themes. All colors adapt via CSS custom properties.</div>
                    <div className="toggle-wrap">
                      <span style={{ fontSize: 12, fontFamily: "'Geist Mono',monospace", color: "var(--tx3)" }}>{darkMode ? "Dark" : "Light"}</span>
                      <Toggle checked={darkMode} onChange={v => setDarkMode(v)} />
                    </div>
                  </div>
                  <div className="setting-card">
                    <div className="setting-card-title">Sidebar</div>
                    <div className="setting-card-desc">Show or hide the navigation sidebar. Can also be toggled with the sidebar button in the topbar.</div>
                    <div className="toggle-wrap">
                      <span style={{ fontSize: 12, fontFamily: "'Geist Mono',monospace", color: "var(--tx3)" }}>{sidebarOpen ? "Visible" : "Hidden"}</span>
                      <Toggle checked={sidebarOpen} onChange={v => setSidebarOpen(v)} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="sec">
                <div className="sec-hd"><span className="sec-lbl">Keyboard Shortcuts</span></div>
                <div className="setting-card" style={{ borderRight: "none" }}>
                  <div className="kbd-grid">
                    <span className="kbd">Space</span><span className="kbd-desc">Play / Pause</span>
                    <span className="kbd">⌘ →</span><span className="kbd-desc">Next track</span>
                    <span className="kbd">⌘ ←</span><span className="kbd-desc">Previous track</span>
                    <span className="kbd">L</span><span className="kbd-desc">Like / unlike current track</span>
                    <span className="kbd">S</span><span className="kbd-desc">Toggle shuffle</span>
                    <span className="kbd">Q</span><span className="kbd-desc">Show / hide queue</span>
                    <span className="kbd">B</span><span className="kbd-desc">Toggle sidebar</span>
                    <span className="kbd">F</span><span className="kbd-desc">Toggle fullscreen</span>
                    <span className="kbd">⌘ K</span><span className="kbd-desc">Command palette</span>
                    <span className="kbd">,</span><span className="kbd-desc">Volume down</span>
                    <span className="kbd">.</span><span className="kbd-desc">Volume up</span>
                  </div>
                </div>
              </div>
              <div className="sec">
                <div className="sec-hd"><span className="sec-lbl">About</span></div>
                <div className="setting-card">
                  <div className="about-logo">
                    <WaveLogo size={22} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-.02em" }}>WAVE</div>
                      <div className="about-version">v1.1.0 · built with Deezer API + YouTube IFrame API</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--tx3)", fontFamily: "'Geist Mono',monospace", lineHeight: 1.6 }}>
                    Music search and playback powered by the Deezer catalog. Audio delivered via YouTube. No data is stored or transmitted.
                  </div>
                  <div className="stat-row">
                    <div className="stat-box"><div className="stat-val">{liked.length}</div><div className="stat-key">Saved tracks</div></div>
                    <div className="stat-box"><div className="stat-val">{recent.length}</div><div className="stat-key">Recently played</div></div>
                    <div className="stat-box"><div className="stat-val">{queue.length}</div><div className="stat-key">In queue</div></div>
                    <div className="stat-box"><div className="stat-val">90M+</div><div className="stat-key">Deezer tracks</div></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* PLAYER BAR */}
        <PlayerBar
          current={current}
          playing={playing}
          buffering={buffering}
          shuffle={shuffle}
          repeat={repeat}
          liked={liked}
          volume={volume}
          ytRef={ytRef}
          onTogglePlay={togglePlay}
          onAdvance={advance}
          onSeek={handleSeek}
          onVolume={changeVol}
          onLike={toggleLike}
          onShuffle={() => { setShuffle(s => { toast(!s ? "Shuffle on" : "Shuffle off"); return !s; }); }}
          onRepeat={() => { setRepeat(r => { toast(!r ? "Repeat on" : "Repeat off"); return !r; }); }}
          onFullscreen={() => setFullscreenOpen(true)}
        />

        {/* MOBILE BOTTOM NAV */}
        <nav className="mobile-nav">
          {[
            { v: "home", label: "Home", ico: <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> },
            { v: "browse", label: "Browse", ico: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> },
            { v: "liked", label: "Saved", ico: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> },
            { v: "lyrics", label: "Lyrics", ico: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> },
            { v: "settings", label: "More", ico: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg> },
          ].map(n => (
            <button key={n.v} className={`mobile-nav-item${view === n.v ? " active" : ""}`} onClick={() => setView(n.v)}>
              {n.ico}
              {n.label}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
