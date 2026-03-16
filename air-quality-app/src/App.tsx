import { useState, useEffect, useRef, useCallback } from "react";


const WAQI_TOKEN       = "587df79d4f5fc40d6632e23d8a2e16ca3d7cf816";
const GOOGLE_CLIENT_ID = "72428308070-boa323muhlh0139gl50am6bq3949mih9.apps.googleusercontent.com";
const COOLDOWN_SEC     = 10;

const AQI_LEVELS = [
  { max:50,  label:"Good",           color:"#22c55e", bg:"rgba(34,197,94,0.10)",  desc:"Air quality is satisfactory. Little or no risk." },
  { max:100, label:"🔶 Moderate",       color:"#eab308", bg:"rgba(234,179,8,0.10)",  desc:"Acceptable. Unusually sensitive people should reduce outdoor exertion." },
  { max:150, label:"Unhealthy*",     color:"#f97316", bg:"rgba(249,115,22,0.10)", desc:"Sensitive groups may experience health effects." },
  { max:200, label:"Unhealthy",      color:"#ef4444", bg:"rgba(239,68,68,0.10)",  desc:"Everyone may begin to experience health effects." },
  { max:300, label:"Very Unhealthy", color:"#a855f7", bg:"rgba(168,85,247,0.10)", desc:"Health alert: everyone may experience serious effects." },
  { max:500, label:"Hazardous",      color:"#e11d48", bg:"rgba(225,29,72,0.10)",  desc:"Emergency conditions. Entire population affected." },
];

const POLL_META: Record<string, { name:string; unit:string; icon:string; safe:number|null; cat:string; desc:string; source:string }> = {
  pm25:{ name:"PM2.5",    unit:"µg/m³",icon:"🔴",safe:12,   cat:"Particles",   desc:"Fine inhalable particles ≤2.5µm",         source:"Vehicle exhaust, fires"      },
  pm10:{ name:"PM10",     unit:"µg/m³",icon:"🟠",safe:54,   cat:"Particles",   desc:"Inhalable coarse particles ≤10µm",        source:"Dust, pollen, construction"  },
  o3:  { name:"Ozone O₃", unit:"ppb",  icon:"🔵",safe:54,   cat:"Gases",       desc:"Ground-level ozone, secondary pollutant", source:"Sunlight + NOₓ + VOCs"       },
  no2: { name:"NO₂",      unit:"ppb",  icon:"🟡",safe:53,   cat:"Gases",       desc:"Nitrogen dioxide from combustion",        source:"Traffic, power plants"       },
  so2: { name:"SO₂",      unit:"ppb",  icon:"🟤",safe:35,   cat:"Gases",       desc:"Sulfur dioxide from fossil fuels",        source:"Coal plants, industry"       },
  co:  { name:"CO",       unit:"ppm",  icon:"⚫",safe:4.4,  cat:"Gases",       desc:"Carbon monoxide, odorless toxic gas",     source:"Incomplete combustion"       },
  no:  { name:"NO",       unit:"ppb",  icon:"🟢",safe:100,  cat:"Gases",       desc:"Nitric oxide, precursor to NO₂",          source:"Combustion engines"          },
  nox: { name:"NOₓ",      unit:"ppb",  icon:"🔶",safe:100,  cat:"Gases",       desc:"Nitrogen oxides (NO + NO₂)",              source:"Transport, heating"          },
  bc:  { name:"Black C",  unit:"µg/m³",icon:"🖤",safe:5,    cat:"Particles",   desc:"Black carbon / soot particles",           source:"Diesel engines, biomass"     },
  nh3: { name:"NH₃",      unit:"µg/m³",icon:"🟣",safe:200,  cat:"Gases",       desc:"Ammonia, pungent irritant",               source:"Agriculture, fertilizers"    },
  ch4: { name:"CH₄",      unit:"ppm",  icon:"🟤",safe:1.9,  cat:"Gases",       desc:"Methane, potent greenhouse gas",          source:"Livestock, landfills, gas"   },
  co2: { name:"CO₂",      unit:"ppm",  icon:"⚪",safe:400,  cat:"Gases",       desc:"Carbon dioxide, greenhouse gas",          source:"Fossil fuels, deforestation" },
  pb:  { name:"Lead Pb",  unit:"µg/m³",icon:"🔘",safe:0.15, cat:"Heavy Metals",desc:"Lead particles, toxic heavy metal",       source:"Leaded fuel legacy, smelters"},
  dew: { name:"Dew Point",unit:"°C",   icon:"💦",safe:null, cat:"Weather",     desc:"Temperature at which dew forms",          source:"Atmospheric measurement"     },
  h:   { name:"Humidity", unit:"%",    icon:"💧",safe:null, cat:"Weather",     desc:"Relative humidity",                       source:"Atmospheric measurement"     },
  p:   { name:"Pressure", unit:"hPa",  icon:"🔵",safe:null, cat:"Weather",     desc:"Atmospheric pressure",                    source:"Meteorological station"      },
  t:   { name:"Temp",     unit:"°C",   icon:"🌡️",safe:null, cat:"Weather",     desc:"Air temperature",                         source:"Meteorological station"      },
  w:   { name:"Wind",     unit:"m/s",  icon:"💨",safe:null, cat:"Weather",     desc:"Wind speed",                              source:"Meteorological station"      },
  wg:  { name:"Wind Gust",unit:"m/s",  icon:"🌬️",safe:null, cat:"Weather",     desc:"Maximum wind gust speed",                 source:"Meteorological station"      },
};

const POLL_CATS = ["All","Particles","Gases","Heavy Metals","Weather"];
const getInfo  = (aqi: number) => AQI_LEVELS.find(l => aqi <= l.max) || AQI_LEVELS[AQI_LEVELS.length - 1];
const genKey   = () => "AW-" + Math.random().toString(36).slice(2,10).toUpperCase() + "-" + Date.now().toString(36).toUpperCase();
const round2   = (v: number) => Math.round(v * 100) / 100;

function safeGetLS(key: string, fallback: any) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function safeSetLS(key: string, val: any) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function parseWAQI(raw: any) {
  if (!raw?.data) return null;
  const d = raw.data, iaqi = d.iaqi || {}, pollutants: Record<string,number> = {};
  const km: Record<string,string> = { pm25:"pm25",pm10:"pm10",o3:"o3",no2:"no2",so2:"so2",co:"co",no:"no",nox:"nox",bc:"bc",nh3:"nh3",ch4:"ch4",co2:"co2",pb:"pb",dew:"dew",h:"h",p:"p",t:"t",w:"w",wg:"wg" };
  Object.entries(km).forEach(([wk,ok]) => { if (iaqi[wk]?.v != null) pollutants[ok] = round2(iaqi[wk].v); });
  const geo = d.city?.geo;
  return {
    aqi: typeof d.aqi==="number"?d.aqi:parseInt(d.aqi)||null,
    city: d.city?.name||"Unknown",
    lat: Array.isArray(geo)&&geo.length>=2?parseFloat(geo[0]):null,
    lon: Array.isArray(geo)&&geo.length>=2?parseFloat(geo[1]):null,
    station: d.city?.name, dominantPol: d.dominentpol, pollutants,
    updated: d.time?.s||new Date().toISOString(), attributions: d.attributions||[], source:"WAQI",
  };
}

function parseOpenAQ(measurements: any[]) {
  if (!measurements?.length) return {};
  const result: Record<string,number> = {}, pm: Record<string,string> = { pm25:"pm25",pm10:"pm10",o3:"o3",no2:"no2",so2:"so2",co:"co",no:"no",nox:"nox",bc:"bc",nh3:"nh3",ch4:"ch4",co2:"co2",pb:"pb" };
  measurements.forEach((m: any) => { const k=pm[m.parameter]; if(k&&m.value!=null) result[k]=round2(m.value); });
  return result;
}

function useGoogleGSI(onSuccess: (p: any) => void) {
  const cbRef = useRef("aw_gcb_" + Math.random().toString(36).slice(2));
  useEffect(() => {
    (window as any)[cbRef.current] = (response: any) => {
      if (!response?.credential) return;
      try {
        const p = JSON.parse(atob(response.credential.split(".")[1]));
        if (p.email) onSuccess({ name:p.name, email:p.email, avatar:p.picture, provider:"google" });
      } catch {}
    };
    if (!document.getElementById("gsi-script")) {
      const s = document.createElement("script");
      s.id="gsi-script"; s.src="https://accounts.google.com/gsi/client"; s.async=true; s.defer=true;
      document.head.appendChild(s);
    }
    return () => { delete (window as any)[cbRef.current]; };
  }, []);
  const initButton = useCallback((containerId: string) => {
    const cb = cbRef.current;
    const tryInit = () => {
      if (!(window as any).google?.accounts?.id) { setTimeout(tryInit,200); return; }
      (window as any).google.accounts.id.initialize({ client_id:GOOGLE_CLIENT_ID, callback:(window as any)[cb], auto_select:false, cancel_on_tap_outside:true });
      const el = document.getElementById(containerId);
      if (el) (window as any).google.accounts.id.renderButton(el, { theme:"filled_blue",size:"large",width:336,text:"continue_with",shape:"rectangular" });
    };
    tryInit();
  }, []);
  return { initButton };
}

function useCooldown(sec: number) {
  const [rem, setRem] = useState(0);
  const t = useRef<any>(null);
  const start = useCallback(() => {
    setRem(sec); clearInterval(t.current);
    t.current = setInterval(() => setRem(r => { if(r<=1){clearInterval(t.current);return 0;} return r-1; }), 1000);
  }, [sec]);
  useEffect(() => () => clearInterval(t.current), []);
  return { rem, start, ready: rem===0 };
}

function useAuth() {
  const [user, setUser]   = useState<any>(() => safeGetLS("aw_user", null));
  const [users, setUsers] = useState<any>(() => safeGetLS("aw_users", {}));

  const persist = (u: any, us: any) => {
    setUser(u); setUsers(us);
    if (u) safeSetLS("aw_user", u); else { try { localStorage.removeItem("aw_user"); } catch {} }
    safeSetLS("aw_users", us);
  };

  const signup = (email: string, pass: string, name: string) => {
    if (!email||!pass) return "Email and password are required";
    const e = email.trim().toLowerCase();
    if (users[e]) return "Email already registered";
    const u = { email:e, name:name?.trim()||e.split("@")[0], provider:"email",
                createdAt:new Date().toISOString(),
                apiKeys:[{ key:genKey(), name:"Default Key", created:new Date().toISOString(), calls:0 }] };
    persist(u, { ...users, [e]:{ ...u, pass } });
    return null;
  };

  const login = (email: string, pass: string) => {
    if (!email||!pass) return "Email and password are required";
    const e = email.trim().toLowerCase();
    const u = users[e];
    if (!u) return "Email not found";
    if (u.pass!==pass) return "Incorrect password";
    persist({ email:u.email, name:u.name, provider:u.provider||"email", createdAt:u.createdAt, apiKeys:u.apiKeys||[] }, users);
    return null;
  };

  const oauthLogin = (profile: any) => {
    const e = profile.email?.trim().toLowerCase(); if(!e) return;
    const existing = users[e];
    const u = existing
      ? { ...existing, provider:profile.provider, avatar:profile.avatar }
      : { email:e, name:profile.name, provider:profile.provider, avatar:profile.avatar,
          createdAt:new Date().toISOString(),
          apiKeys:[{ key:genKey(), name:"Default Key", created:new Date().toISOString(), calls:0 }] };
    persist(u, { ...users, [e]:{ ...u, pass:"__oauth__" } });
  };

  const logout = () => { setUser(null); try { localStorage.removeItem("aw_user"); } catch {} };

  const addKey = (name: string) => {
    if (!user||(user.apiKeys||[]).length>=10) return;
    const k = { key:genKey(), name:name?.trim()||"New Key", created:new Date().toISOString(), calls:0 };
    const updated = { ...user, apiKeys:[...(user.apiKeys||[]),k] };
    persist(updated, { ...users, [user.email]:{ ...users[user.email], apiKeys:updated.apiKeys } });
  };

  const deleteKey = (key: string) => {
    if (!user) return;
    const updated = { ...user, apiKeys:(user.apiKeys||[]).filter((k: any)=>k.key!==key) };
    persist(updated, { ...users, [user.email]:{ ...users[user.email], apiKeys:updated.apiKeys } });
  };

  return { user, signup, login, oauthLogin, logout, addKey, deleteKey };
}

function useAlerts(aqi: number|null, city: string|null) {
  const [alerts, setAlerts]    = useState<any[]>([]);
  const [threshold, setThresh] = useState(() => parseInt(safeGetLS("aw_thresh","100")));
  const [notifOn, setNotifOn]  = useState(() => safeGetLS("aw_notif","0")==="1");
  const prev = useRef<number|null>(null);

  const setThreshold = (v: number) => { setThresh(v); safeSetLS("aw_thresh",String(v)); };
  const toggleNotif  = () => {
    const n=!notifOn; setNotifOn(n); safeSetLS("aw_notif",n?"1":"0");
    if (n && typeof Notification!=="undefined") Notification.requestPermission();
  };

  useEffect(() => {
    if (aqi==null||!city) return;
    const info=getInfo(aqi), p=prev.current;
    if (p!==null&&aqi>threshold&&p<=threshold) {
      const msg=`⚠️ AQI in ${city} rose to ${aqi} (${info.label})`;
      setAlerts(a=>[{ id:Date.now(),msg,aqi,time:new Date().toLocaleTimeString(),color:info.color },...a.slice(0,29)]);
      if (notifOn&&typeof Notification!=="undefined"&&Notification.permission==="granted") new Notification("AirWatch Alert",{body:msg});
    }
    if (p!==null&&aqi<=threshold&&p>threshold) {
      const msg=`✅ AQI in ${city} back to ${aqi} (${info.label})`;
      setAlerts(a=>[{ id:Date.now(),msg,aqi,time:new Date().toLocaleTimeString(),color:info.color },...a.slice(0,29)]);
    }
    prev.current=aqi;
  }, [aqi,city,threshold,notifOn]);

  return { alerts, threshold, setThreshold, notifOn, toggleNotif, clearAlerts:()=>setAlerts([]) };
}

function useSearchHistory() {
  const [history, setHistory] = useState<any[]>(() => safeGetLS("aw_search_hist", []));

  const addSearch = useCallback((city: string, lat: number|null, lon: number|null, aqi: number) => {
    setHistory(prev => {
      const entry = { city, lat, lon, aqi, searched_at: new Date().toISOString() };
      const filtered = prev.filter((h: any) => h.city !== city);
      const updated = [entry, ...filtered].slice(0, 20);
      safeSetLS("aw_search_hist", updated);
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    safeSetLS("aw_search_hist", []);
  }, []);

  return { history, addSearch, clearHistory };
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// ─── SHARE CARD (rendered off-screen, captured by html2canvas) ──────────────
function ShareCard({ airData, aqi, info, allPolls, cardRef }: {
  airData: any; aqi: number; info: any; allPolls: Record<string,number>; cardRef: React.RefObject<HTMLDivElement>;
}) {
  const now = new Date();
  const timestamp = now.toLocaleDateString("en-US", { weekday:"short", year:"numeric", month:"short", day:"numeric" })
    + " · " + now.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" });

  const dominantMeta = airData.dominantPol ? POLL_META[airData.dominantPol] : null;
  const pm25 = allPolls["pm25"];
  const aqi_emoji = aqi<=50?"😊":aqi<=100?"😐":aqi<=150?"😷":aqi<=200?"🤧":aqi<=300?"😰":"🆘";

  // AQI arc SVG params
  const r=62, cx=90, cy=90;
  const pct = Math.min(aqi / 300, 1);
  const arcPoint = (angle: number) => {
    const rad = (angle - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [sx, sy] = arcPoint(-135);
  const [ex, ey] = arcPoint(135);
  const [fx, fy] = arcPoint(-135 + pct * 270);
  const largeArc = pct * 270 > 180 ? 1 : 0;

  return (
    <div
      ref={cardRef}
      style={{
        position: "fixed",
        left: "-9999px",
        top: 0,
        width: 520,
        background: "#07071a",
        borderRadius: 0,
        overflow: "hidden",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        padding: 0,
        zIndex: -1,
      }}
    >
      {/* Top accent bar */}
      <div style={{ height: 4, background: `linear-gradient(90deg, ${info.color}, ${info.color}88, transparent)` }} />

      {/* Header */}
      <div style={{
        padding: "20px 28px 16px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: "1px solid #1a1a2e",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24,
          }}>🌍</div>
          <div>
            <div style={{
              fontSize: 16, fontWeight: 800, letterSpacing: -0.5,
              color: "#60a5fa",
            }}>AtmoPulse</div>
            <div style={{ fontSize: 8, color: "#374151", letterSpacing: 3, marginTop: -1 }}>REAL-TIME AIR QUALITY</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#374151", letterSpacing: 1 }}>LIVE REPORT</div>
          <div style={{ fontSize: 9, color: "#4b5563", marginTop: 2 }}>{timestamp}</div>
        </div>
      </div>

      {/* City + AQI hero */}
      <div style={{
        padding: "24px 28px",
        background: `radial-gradient(ellipse at top left, ${info.color}0d 0%, transparent 60%)`,
        display: "flex",
        gap: 24,
        alignItems: "center",
      }}>
        {/* Gauge SVG */}
        <div style={{ flexShrink: 0 }}>
          <svg viewBox="0 0 180 120" width="180" height="120">
            <path
              d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`}
              fill="none" stroke="#16213e" strokeWidth="12" strokeLinecap="round"
            />
            {pct > 0 && (
              <path
                d={`M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${fx} ${fy}`}
                fill="none" stroke={info.color} strokeWidth="12" strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 8px ${info.color})` }}
              />
            )}
            <text x={cx} y={cy - 4} textAnchor="middle" fill={info.color}
              style={{ fontSize: 32, fontWeight: 900, fontFamily: "monospace" }}>
              {aqi}
            </text>
            <text x={cx} y={cy + 14} textAnchor="middle" fill={info.color}
              style={{ fontSize: 10, letterSpacing: 1 }}>
              {info.label}
            </text>
            <text x={cx} y={cy + 27} textAnchor="middle" fill="#4b5563"
              style={{ fontSize: 8, letterSpacing: 2 }}>
              AQI · US EPA
            </text>
          </svg>
        </div>

        {/* City + status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 24, marginBottom: 4 }}>{aqi_emoji}</div>
          <div style={{
            fontSize: 22, fontWeight: 900, color: "#e2e8f0",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            marginBottom: 4,
          }}>{airData.city}</div>
          <div style={{
            display: "inline-block",
            background: info.bg, border: `1px solid ${info.color}44`,
            borderRadius: 20, padding: "4px 14px",
            fontSize: 11, fontWeight: 700, color: info.color,
            marginBottom: 12,
          }}>{info.label}</div>
          <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.6, maxWidth: 200 }}>
            {info.desc}
          </div>
          {dominantMeta && (
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 9, color: "#4b5563", letterSpacing: 1, textTransform: "uppercase" }}>Dominant:</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: info.color, fontFamily: "monospace" }}>
                {dominantMeta.icon} {dominantMeta.name}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* AQI scale bar */}
      <div style={{ padding: "0 28px 20px" }}>
        <div style={{ display: "flex", gap: 3, height: 22 }}>
          {AQI_LEVELS.map((l, i) => {
            const active = aqi <= l.max && (i === 0 || aqi > AQI_LEVELS[i-1].max);
            return (
              <div key={i} style={{
                flex: 1, borderRadius: 5,
                background: l.color,
                opacity: active ? 1 : 0.12,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: active ? `0 0 10px ${l.color}` : "none",
              }}>
                {active && <div style={{ width: 4, height: 4, background: "white", borderRadius: "50%" }} />}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 8, color: "#374151" }}>0 — Good</span>
          <span style={{ fontSize: 8, color: "#374151" }}>500 — Hazardous</span>
        </div>
      </div>

      {/* Key pollutants */}
      <div style={{ padding: "0 28px 20px" }}>
        <div style={{ fontSize: 9, color: "#374151", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
          KEY POLLUTANTS
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {(["pm25","pm10","o3","no2","co","so2"] as const)
            .filter(k => allPolls[k] != null)
            .slice(0, 6)
            .map(k => {
              const meta = POLL_META[k];
              const val = allPolls[k];
              const safe = meta.safe;
              const pctVal = safe ? Math.min((val / (safe * 3)) * 100, 100) : null;
              const col = !safe ? "#60a5fa" : pctVal !== null && pctVal < 33 ? "#22c55e" : pctVal !== null && pctVal < 66 ? "#eab308" : "#ef4444";
              return (
                <div key={k} style={{
                  background: "#0f0f1c",
                  border: `1px solid #1e2035`,
                  borderRadius: 10, padding: "10px 12px",
                }}>
                  <div style={{ fontSize: 9, color: "#4b5563", marginBottom: 3 }}>{meta.icon} {meta.name}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: col, fontFamily: "monospace", lineHeight: 1 }}>
                    {val}
                    <span style={{ fontSize: 8, color: "#374151", marginLeft: 2 }}>{meta.unit}</span>
                  </div>
                  {safe != null && pctVal != null && (
                    <div style={{ marginTop: 5, height: 3, background: "#16213e", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pctVal}%`, background: col, borderRadius: 2 }} />
                    </div>
                  )}
                </div>
              );
            })
          }
        </div>
      </div>

      {/* Weather strip */}
      {(allPolls.t != null || allPolls.h != null || allPolls.w != null || allPolls.p != null) && (
        <div style={{
          margin: "0 28px 20px",
          background: "#0a0a18",
          border: "1px solid #1a1a2e",
          borderRadius: 12,
          padding: "12px 16px",
          display: "flex",
          gap: 0,
        }}>
          {[
            { k: "t", icon: "🌡️", label: "Temp" },
            { k: "h", icon: "💧", label: "Humidity" },
            { k: "w", icon: "💨", label: "Wind" },
            { k: "p", icon: "🔵", label: "Pressure" },
          ].filter(({ k }) => allPolls[k] != null).map(({ k, icon, label }, i, arr) => (
            <div key={k} style={{
              flex: 1, textAlign: "center",
              borderRight: i < arr.length - 1 ? "1px solid #1a1a2e" : "none",
              padding: "0 8px",
            }}>
              <div style={{ fontSize: 14, marginBottom: 2 }}>{icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>
                {allPolls[k]}<span style={{ fontSize: 8, color: "#4b5563", marginLeft: 1 }}>{POLL_META[k].unit}</span>
              </div>
              <div style={{ fontSize: 8, color: "#374151", marginTop: 1, letterSpacing: 1 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{
        padding: "12px 28px 16px",
        borderTop: "1px solid #1a1a2e",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ fontSize: 9, color: "#374151" }}>
          Data: WAQI · OpenAQ · US EPA Standard
        </div>
        <div style={{
          fontSize: 9, color: info.color,
          background: info.bg,
          border: `1px solid ${info.color}33`,
          borderRadius: 6, padding: "3px 10px",
          fontWeight: 700,
        }}>atmopulse.web.app</div>
      </div>

      {/* Bottom accent */}
      <div style={{ height: 3, background: `linear-gradient(90deg, transparent, ${info.color}88, ${info.color})` }} />
    </div>
  );
}

// ─── SHARE BUTTON ─────────────────────────────────────────────────────────────
function ShareButton({ airData, aqi, info, allPolls, isMobile }: {
  airData: any; aqi: number; info: any; allPolls: Record<string,number>; isMobile: boolean;
}) {
  const [sharing, setSharing] = useState(false);
  const [status, setStatus]   = useState<"idle"|"capturing"|"sharing"|"done"|"error">("idle");
  const cardRef = useRef<HTMLDivElement>(null);

  const loadHtml2Canvas = (): Promise<any> => {
    return new Promise((resolve, reject) => {
      if ((window as any).html2canvas) { resolve((window as any).html2canvas); return; }
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      s.onload = () => resolve((window as any).html2canvas);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  };

  const handleShare = async () => {
    if (sharing || !cardRef.current) return;
    setSharing(true);
    setStatus("capturing");

    try {
      const html2canvas = await loadHtml2Canvas();

      // Make card temporarily visible off-screen for capture
      if (cardRef.current) {
        cardRef.current.style.left = "-9999px";
        cardRef.current.style.position = "fixed";
        cardRef.current.style.zIndex = "-1";
      }

      await new Promise(r => setTimeout(r, 120)); // let fonts settle

      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#07071a",
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        width: 520,
        windowWidth: 520,
      });

      setStatus("sharing");

      const citySlug = (airData.city || "city").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
      const filename = `AtmoPulse_${citySlug}.png`;

      if (navigator.share && navigator.canShare) {
        // Try native share (mobile)
        try {
          canvas.toBlob(async (blob: Blob | null) => {
            if (!blob) throw new Error("Canvas blob failed");
            const file = new File([blob], filename, { type: "image/png" });
            const canShareFiles = navigator.canShare({ files: [file] });

            if (canShareFiles) {
              await navigator.share({
                title: `AtmoPulse — ${airData.city} AQI ${aqi}`,
                text: `🌍 ${airData.city} air quality is ${info.label} (AQI ${aqi}). Check live air quality on AtmoPulse.`,
                files: [file],
              });
              setStatus("done");
            } else {
              // Share without file (text only)
              await navigator.share({
                title: `AtmoPulse — ${airData.city} AQI ${aqi}`,
                text: `🌍 ${airData.city} air quality is currently ${info.label} (AQI ${aqi}).`,
              });
              // Also download image as bonus
              downloadCanvas(canvas, filename);
              setStatus("done");
            }
          }, "image/png");
        } catch (shareErr: any) {
          if (shareErr?.name !== "AbortError") {
            // Fall back to download
            downloadCanvas(canvas, filename);
            setStatus("done");
          } else {
            setStatus("idle");
          }
        }
      } else {
        // Desktop / no Share API — download directly
        downloadCanvas(canvas, filename);
        setStatus("done");
      }
    } catch (e) {
      console.error("Share failed:", e);
      setStatus("error");
    } finally {
      setSharing(false);
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const downloadCanvas = (canvas: HTMLCanvasElement, filename: string) => {
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const btnLabel =
    status === "capturing" ? "Rendering..." :
    status === "sharing"   ? "Opening..." :
    status === "done"      ? "✓ Shared!" :
    status === "error"     ? "Failed" :
    isMobile ? "Share 📤" : "Share 📤";

  const btnColor =
    status === "done"  ? "#22c55e" :
    status === "error" ? "#ef4444" :
    info.color;

  return (
    <>
      {/* Hidden share card rendered off-screen */}
      <ShareCard
        airData={airData}
        aqi={aqi}
        info={info}
        allPolls={allPolls}
        cardRef={cardRef}
      />

      <button
        onClick={handleShare}
        disabled={sharing}
        title="Share air quality report as image"
        style={{
          background: sharing ? `${btnColor}22` : `${btnColor}18`,
          border: `1px solid ${btnColor}${sharing ? "55" : "44"}`,
          borderRadius: 10,
          color: btnColor,
          padding: isMobile ? "6px 10px" : "7px 14px",
          cursor: sharing ? "not-allowed" : "pointer",
          fontSize: isMobile ? 11 : 12,
          fontWeight: 700,
          flexShrink: 0,
          transition: "all .2s",
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          gap: 4,
          opacity: sharing ? 0.7 : 1,
        }}
      >
        {sharing && (
          <span style={{
            display: "inline-block",
            width: 10, height: 10,
            border: `2px solid ${btnColor}44`,
            borderTopColor: btnColor,
            borderRadius: "50%",
            animation: "spin 0.7s linear infinite",
          }} />
        )}
        {btnLabel}
      </button>
    </>
  );
}

function AuthModal({ onClose, auth }: { onClose: () => void; auth: any }) {
  const [mode,setMode]   = useState("login");
  const [email,setEmail] = useState("");
  const [pass,setPass]   = useState("");
  const [name,setName]   = useState("");
  const [err,setErr]     = useState("");
  const [busy,setBusy]   = useState(false);
  const gBtnId = "aw-google-btn";
  const { initButton } = useGoogleGSI((profile)=>{ auth.oauthLogin(profile); onClose(); });
  useEffect(()=>{ const t=setTimeout(()=>initButton(gBtnId),150); return()=>clearTimeout(t); },[initButton]);

  const submit = async () => {
    setErr(""); if(!email||!pass){setErr("All fields required");return;} setBusy(true);
    await new Promise(r=>setTimeout(r,80));
    const e = mode==="login" ? auth.login(email,pass) : auth.signup(email,pass,name);
    setBusy(false); if(e) setErr(e); else onClose();
  };

  const inp: React.CSSProperties = { background:"#0a0a14",border:"1px solid #1e2035",borderRadius:10,color:"#e2e8f0",padding:"11px 14px",fontSize:14,outline:"none",width:"100%",fontFamily:"inherit",boxSizing:"border-box" };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",backdropFilter:"blur(8px)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onMouseDown={e=>{e.preventDefault();onClose();}}>
      <div style={{background:"#0d0d1f",border:"1px solid #1e2035",borderRadius:24,padding:32,width:"100%",maxWidth:400,boxShadow:"0 40px 100px rgba(0,0,0,.9)"}} onMouseDown={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
          <div style={{fontSize:20,fontWeight:800,color:"#e2e8f0"}}>{mode==="login"?"Welcome back":"Create account"}</div>
          <button onClick={onClose} style={{background:"#1a1a2e",border:"none",borderRadius:8,color:"#6b7280",fontSize:16,cursor:"pointer",width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
        <div style={{marginBottom:20}}><div id={gBtnId} style={{width:"100%",minHeight:44,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:12,overflow:"hidden"}}/></div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}><div style={{flex:1,height:1,background:"#1e2035"}}/><span style={{fontSize:11,color:"#374151"}}>or email</span><div style={{flex:1,height:1,background:"#1e2035"}}/></div>
        <div style={{display:"flex",gap:4,background:"#06060f",borderRadius:10,padding:4,marginBottom:14}}>
          {["login","signup"].map(m=><button key={m} onClick={()=>{setMode(m);setErr("");}} style={{flex:1,background:mode===m?"#1e2035":"transparent",border:"none",borderRadius:8,color:mode===m?"#e2e8f0":"#4b5563",padding:"8px",cursor:"pointer",fontSize:13,fontWeight:mode===m?700:400,transition:"all .2s"}}>{m==="login"?"🔑 Sign In":"✨ Sign Up"}</button>)}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {mode==="signup"&&<input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} style={inp}/>}
          <input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} type="email" style={inp} autoComplete="email"/>
          <input placeholder="Password" value={pass} onChange={e=>setPass(e.target.value)} type="password" style={inp} autoComplete={mode==="login"?"current-password":"new-password"} onKeyDown={e=>e.key==="Enter"&&submit()}/>
        </div>
        {err&&<div style={{color:"#f87171",fontSize:12,marginTop:10,background:"#1c0505",padding:"8px 12px",borderRadius:8}}>{err}</div>}
        <button onClick={submit} disabled={busy} style={{marginTop:14,width:"100%",background:busy?"#1e3a5f":"linear-gradient(135deg,#3b82f6,#1d4ed8)",border:"none",borderRadius:12,color:"white",padding:"12px",cursor:busy?"not-allowed":"pointer",fontSize:15,fontWeight:700,transition:"background .2s"}}>
          {busy?"...":mode==="login"?"Sign In →":"Create Account →"}
        </button>
      </div>
    </div>
  );
}

function LiveMap({ lat, lon, city, aqi }: { lat: number|null; lon: number|null; city: string; aqi: number|null }) {
  const ref=useRef<HTMLDivElement>(null), inst=useRef<any>(null), mk=useRef<any>(null);
  const info = aqi!=null?getInfo(aqi):null;
  const renderMap = useCallback(() => {
    if (!ref.current||!(window as any).L||!lat||!lon) return;
    const color = info?.color||"#22c55e";
    if (!inst.current) {
      const map=(window as any).L.map(ref.current,{zoomControl:false,attributionControl:false});
      map.setView([lat,lon],11);
      (window as any).L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(map);
      (window as any).L.control.zoom({position:"bottomright"}).addTo(map);
      inst.current=map;
    } else { inst.current.flyTo([lat,lon],11,{duration:1.2}); }
    const icon=(window as any).L.divIcon({html:`<div style="position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center"><div style="position:absolute;width:40px;height:40px;border-radius:50%;background:${color}33;animation:mpulse 2s infinite"></div><div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 14px ${color}88"></div></div>`,iconSize:[40,40],iconAnchor:[20,20],className:""});
    if (mk.current) mk.current.remove();
    mk.current=(window as any).L.marker([lat,lon],{icon}).addTo(inst.current).bindPopup(`<b style="color:#e2e8f0">${city||"Station"}</b><br><span style="color:${color}">AQI ${aqi||"—"} · ${info?.label||""}</span>`).openPopup();
    setTimeout(()=>inst.current?.invalidateSize(),100);
  }, [lat,lon,aqi,city,info]);
  useEffect(()=>{
    if (!lat||!lon) return;
    if ((window as any).L){renderMap();return;}
    if (!document.querySelector('link[href*="leaflet"]')){const css=document.createElement("link");css.rel="stylesheet";css.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";document.head.appendChild(css);}
    if (!document.querySelector('script[src*="leaflet"]')){const js=document.createElement("script");js.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";(js as any).onload=renderMap;document.head.appendChild(js);}
    else{const t=setInterval(()=>{if((window as any).L){clearInterval(t);renderMap();}},100);return()=>clearInterval(t);}
  },[lat,lon,aqi,renderMap]);
  useEffect(()=>()=>{if(mk.current){try{mk.current.remove();}catch{}mk.current=null;}if(inst.current){try{inst.current.remove();}catch{}inst.current=null;}},[]);
  return (
    <div style={{position:"relative",height:"100%",borderRadius:16,overflow:"hidden",background:"#0a0a14",minHeight:300}}>
      <div ref={ref} style={{width:"100%",height:"100%",minHeight:300}}/>
      {(!lat||!lon)&&<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#374151",gap:8,zIndex:1}}><span style={{fontSize:36}}>🗺️</span><span style={{fontSize:13}}>Search a city or tap 📍 to detect location</span></div>}
      {aqi!=null&&info&&<div style={{position:"absolute",top:12,left:12,background:"rgba(6,6,15,.92)",backdropFilter:"blur(8px)",border:`1px solid ${info.color}44`,borderRadius:10,padding:"8px 14px",zIndex:1000,pointerEvents:"none"}}><div style={{fontSize:9,color:"#6b7280",letterSpacing:2,textTransform:"uppercase"}}>Live AQI</div><div style={{fontSize:24,fontWeight:900,color:info.color,fontFamily:"monospace",lineHeight:1}}>{aqi}</div><div style={{fontSize:10,color:info.color}}>{info.label}</div></div>}
      {city&&lat&&<div style={{position:"absolute",bottom:12,left:12,background:"rgba(6,6,15,.85)",backdropFilter:"blur(6px)",border:"1px solid #1a1a2e",borderRadius:8,padding:"5px 12px",zIndex:1000,fontSize:11,color:"#94a3b8",pointerEvents:"none"}}>📍 {city} · {lat?.toFixed(3)}, {lon?.toFixed(3)}</div>}
    </div>
  );
}

function Gauge({ value, max=300 }: { value: number; max?: number }) {
  const pct=Math.min(value/max,1),ang=-135+pct*270,info=getInfo(value),r=70,cx=90,cy=92;
  const arc=(a: number)=>{const rad=(a-90)*Math.PI/180;return[cx+r*Math.cos(rad),cy+r*Math.sin(rad)];};
  const [sx,sy]=arc(-135),[ex,ey]=arc(135),[fx,fy]=arc(-135+pct*270);
  return (
    <div style={{position:"relative",width:180,height:120,margin:"0 auto"}}>
      <svg viewBox="0 0 180 120" width="180" height="120">
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke="#16213e" strokeWidth="13" strokeLinecap="round"/>
        {pct>0&&<path d={`M ${sx} ${sy} A ${r} ${r} 0 ${pct*270>180?1:0} 1 ${fx} ${fy}`} fill="none" stroke={info.color} strokeWidth="13" strokeLinecap="round" style={{filter:`drop-shadow(0 0 8px ${info.color})`,transition:"all 1.2s cubic-bezier(.4,0,.2,1)"}}/>}
        <g transform={`rotate(${ang},${cx},${cy})`} style={{transition:"transform 1.2s cubic-bezier(.4,0,.2,1)"}}>
          <line x1={cx} y1={cy} x2={cx} y2={cy-54} stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
          <circle cx={cx} cy={cy} r="6" fill={info.color} style={{filter:`drop-shadow(0 0 5px ${info.color})`}}/>
        </g>
      </svg>
      <div style={{position:"absolute",bottom:0,width:"100%",textAlign:"center",lineHeight:1}}>
        <div style={{fontSize:38,fontWeight:900,color:info.color,fontFamily:"monospace",textShadow:`0 0 20px ${info.color}88`}}>{value}</div>
        <div style={{fontSize:9,color:"#4b5563",letterSpacing:3,marginTop:2}}>AQI · US EPA</div>
      </div>
    </div>
  );
}

function Sparkline({ history }: { history: any[] }) {
  if (!history||history.length<2) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:80,color:"#374151",fontSize:12,flexDirection:"column",gap:6}}><span style={{fontSize:24}}>📊</span>Refresh a few times to see trend</div>;
  const W=500,H=60,vals=history.map((h: any)=>h.aqi),mn=Math.min(...vals),mx=Math.max(...vals,mn+10);
  const pts=history.map((h: any,i: number)=>({x:(i/(history.length-1))*(W-10)+5,y:H-5-((h.aqi-mn)/(mx-mn+1))*(H-14),...h}));
  const d=pts.map((p: any,i: number)=>`${i===0?"M":"L"} ${p.x} ${p.y}`).join(" "),info=getInfo(vals[vals.length-1]);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <defs><linearGradient id="sg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={info.color} stopOpacity="0.2"/><stop offset="100%" stopColor={info.color} stopOpacity="0"/></linearGradient></defs>
        <path d={`${d} L ${pts[pts.length-1].x} ${H} L ${pts[0].x} ${H} Z`} fill="url(#sg2)"/>
        <path d={d} fill="none" stroke={info.color} strokeWidth="2" style={{filter:`drop-shadow(0 0 3px ${info.color})`}}/>
        {pts.map((p: any,i: number)=><circle key={i} cx={p.x} cy={p.y} r="3" fill={info.color}/>)}
      </svg>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
        {pts.map((p: any,i: number)=><div key={i} style={{textAlign:"center"}}><div style={{fontSize:9,color:info.color,fontFamily:"monospace",fontWeight:700}}>{p.aqi}</div><div style={{fontSize:8,color:"#374151"}}>{p.time}</div></div>)}
      </div>
    </div>
  );
}

function Search({ onSearch, loading }: { onSearch: (s: any) => void; loading: boolean }) {
  const [q,setQ]=useState(""),[sugs,setSugs]=useState<any[]>([]),[showDrop,setShowDrop]=useState(false),[busy,setBusy]=useState(false),[focusedIdx,setFocusedIdx]=useState(-1);
  const db=useRef<any>(null),wrap=useRef<HTMLDivElement>(null);
  useEffect(()=>{const h=(e: MouseEvent)=>{if(wrap.current&&!wrap.current.contains(e.target as Node))setShowDrop(false);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  const suggest=useCallback(async (v: string)=>{
    if(v.length<2){setSugs([]);setShowDrop(false);return;}setBusy(true);
    try{
      const [nomRes,waqiRes]=await Promise.allSettled([
        fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(v)}&format=json&limit=8&addressdetails=1&dedupe=1`).then(r=>r.json()),
        fetch(`https://api.waqi.info/search/?token=${WAQI_TOKEN}&keyword=${encodeURIComponent(v)}`).then(r=>r.json()),
      ]);

      const results: any[]=[];
      // Normalize a string for duplicate comparison: lowercase, strip punctuation/spaces
      const norm = (s: string) => s?.toLowerCase().replace(/[^a-z0-9]/g,"") || "";

      // Track seen keys to deduplicate across all sources
      const seenLabels  = new Set<string>();
      const seenCoords  = new Set<string>(); // "lat2,lon2" bucketed to 2 decimal places (~1km)
      const coordKey    = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

      if(nomRes.status==="fulfilled"&&Array.isArray(nomRes.value)){
        nomRes.value.forEach((x: any)=>{
          const cn  = x.address?.city||x.address?.town||x.address?.village||x.address?.county||x.name;
          const st  = x.address?.state||"";
          const ctr = x.address?.country||"";
          const label = [cn,st,ctr].filter(Boolean).join(", ");
          const lat = parseFloat(x.lat), lon = parseFloat(x.lon);
          const lkey = norm(label), ckey = coordKey(lat, lon);
          // Skip if same label or same ~1km bucket already added
          if(seenLabels.has(lkey)||seenCoords.has(ckey)) return;
          seenLabels.add(lkey); seenCoords.add(ckey);
          results.push({label,city:cn,state:st,country:ctr,lat,lon,type:"geo",aqi:null,waqiUid:null});
        });
      }

      if(waqiRes.status==="fulfilled"&&(waqiRes.value as any)?.status==="ok"){
        ((waqiRes.value as any).data||[]).forEach((s: any)=>{
          const slat=parseFloat(s.station?.geo?.[0]),slon=parseFloat(s.station?.geo?.[1]);
          const aqiVal=parseFloat(s.aqi);
          const sname=s.station?.name||`Station #${s.uid}`;
          if(isNaN(slat)||isNaN(slon)) return;
          const ckey = coordKey(slat, slon);
          const lkey = norm(sname);
          // Skip if within ~1km of an existing result or exact same station name
          if(seenCoords.has(ckey)||seenLabels.has(lkey)) return;
          seenLabels.add(lkey); seenCoords.add(ckey);
          results.push({label:sname,city:sname,lat:slat,lon:slon,type:"station",aqi:isNaN(aqiVal)?null:aqiVal,waqiUid:s.uid});
        });
      }

      // Sort: geo results first (they have real place names), then stations
      results.sort((a,b)=> a.type===b.type ? 0 : a.type==="geo" ? -1 : 1);
      const final=results.slice(0,7);
      setSugs(final);setShowDrop(final.length>0);setFocusedIdx(-1);
    }catch{setSugs([]);setShowDrop(false);}finally{setBusy(false);}
  },[]);
  const pick=useCallback((s: any)=>{setQ(s.label);setSugs([]);setShowDrop(false);setFocusedIdx(-1);onSearch(s);},[onSearch]);
  const go=()=>{if(focusedIdx>=0&&sugs[focusedIdx]){pick(sugs[focusedIdx]);return;}if(sugs.length>0)pick(sugs[0]);};
  const handleKeyDown=(e: React.KeyboardEvent)=>{
    if(!showDrop||sugs.length===0){if(e.key==="Enter")go();return;}
    if(e.key==="ArrowDown"){e.preventDefault();setFocusedIdx(i=>Math.min(i+1,sugs.length-1));}
    else if(e.key==="ArrowUp"){e.preventDefault();setFocusedIdx(i=>Math.max(i-1,0));}
    else if(e.key==="Enter"){e.preventDefault();go();}
    else if(e.key==="Escape"){setShowDrop(false);setFocusedIdx(-1);}
  };
  return (
    <div ref={wrap} style={{position:"relative"}}>
      <div style={{display:"flex",gap:8}}>
        <div style={{flex:1,position:"relative"}}>
          <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:14,pointerEvents:"none",color:"#4b5563"}}>{busy?"⟳":"🔍"}</span>
          <input value={q} onChange={e=>{const v=e.target.value;setQ(v);clearTimeout(db.current);if(v.length<2){setSugs([]);setShowDrop(false);return;}db.current=setTimeout(()=>suggest(v),320);}} onFocus={()=>{if(sugs.length>0)setShowDrop(true);}} onKeyDown={handleKeyDown} placeholder="Search any city..." style={{width:"100%",background:"#0a0a14",border:"1px solid #1e2035",borderRadius:10,color:"#e2e8f0",padding:"10px 12px 10px 32px",fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
        </div>
        <button onClick={go} disabled={loading||busy} style={{background:"linear-gradient(135deg,#3b82f6,#1d4ed8)",border:"none",borderRadius:10,color:"white",padding:"10px 16px",cursor:(loading||busy)?"not-allowed":"pointer",fontSize:13,fontWeight:700,opacity:(loading||busy)?0.6:1}}>Go</button>
        <button onClick={()=>onSearch(null)} title="Detect my location" style={{background:"#0a0a14",border:"1px solid #1e2035",borderRadius:10,color:"#6b7280",padding:"10px 12px",cursor:"pointer",fontSize:16}}>📍</button>
      </div>
      {showDrop&&sugs.length>0&&(
        <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,zIndex:9999,background:"#0d0d1f",border:"1px solid #1e2035",borderRadius:12,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,.95)"}}>
          {sugs.map((s,i)=>(
            <div key={i} onMouseDown={e=>{e.preventDefault();pick(s);}} onMouseEnter={()=>setFocusedIdx(i)} style={{padding:"11px 14px",cursor:"pointer",borderBottom:i<sugs.length-1?"1px solid #0f0f1a":"none",display:"flex",alignItems:"center",gap:10,userSelect:"none",background:i===focusedIdx?"#1a1a2e":"transparent",transition:"background .1s"}}>
              <span style={{fontSize:16,flexShrink:0}}>{s.type==="station"?"📡":"📍"}</span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.label}</div><div style={{fontSize:9,color:"#374151",marginTop:2}}>{s.type==="station"?"Monitoring Station":`${s.state?s.state+", ":""}${s.country||""}`}</div></div>
              {s.aqi!=null&&<div style={{textAlign:"center",flexShrink:0}}><div style={{fontSize:14,fontWeight:800,color:getInfo(s.aqi).color,fontFamily:"monospace"}}>{s.aqi}</div><div style={{fontSize:8,color:getInfo(s.aqi).color}}>AQI</div></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PollCard({ pkey, value, isMajor, source }: { pkey: string; value: number; isMajor: boolean; source: string }) {
  const meta=POLL_META[pkey]; if(!meta) return null;
  const hasT=meta.safe!=null,pct=hasT?Math.min((value/((meta.safe as number)*3))*100,100):null;
  const color=!hasT?"#60a5fa":pct!==null&&pct<33?"#22c55e":pct!==null&&pct<66?"#eab308":"#ef4444";
  const status=!hasT?null:pct!==null&&pct<33?"✓ Safe":pct!==null&&pct<66?"⚠ Moderate":"✗ High";
  return (
    <div style={{background:isMajor?"#0f0f1a":"#0a0a14",border:`1px solid ${isMajor?"#3b82f655":"#1a1a2e"}`,borderRadius:14,padding:"14px 16px",position:"relative"}}>
      {isMajor&&<div style={{position:"absolute",top:8,right:8,background:"#3b82f622",color:"#60a5fa",fontSize:8,borderRadius:4,padding:"2px 6px",letterSpacing:1}}>★ DOMINANT</div>}
      <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:10}}>
        <span style={{fontSize:22,lineHeight:1,flexShrink:0}}>{meta.icon}</span>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:isMajor?"#60a5fa":"#e2e8f0"}}>{meta.name}</div><div style={{fontSize:9,color:"#4b5563",marginTop:1,lineHeight:1.4}}>{meta.desc}</div></div>
        <div style={{textAlign:"right",flexShrink:0}}><div style={{fontSize:18,fontWeight:900,color,fontFamily:"monospace"}}>{value}<span style={{fontSize:9,color:"#4b5563",marginLeft:2}}>{meta.unit}</span></div>{hasT&&<div style={{fontSize:9,color:"#374151"}}>safe ≤{meta.safe}</div>}</div>
      </div>
      {hasT&&pct!=null&&<div style={{height:4,background:"#16213e",borderRadius:4,overflow:"hidden",marginBottom:4}}><div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${color}88,${color})`,borderRadius:4,transition:"width 1s ease"}}/></div>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:9,color:"#374151"}}>{meta.source}</span>
        <div style={{display:"flex",gap:6,alignItems:"center"}}><span style={{fontSize:8,background:"#1a1a2e",color:"#4b5563",borderRadius:4,padding:"1px 5px"}}>{source}</span>{status&&<span style={{fontSize:9,color,fontWeight:600}}>{status}</span>}</div>
      </div>
    </div>
  );
}

function AQIScale({ current }: { current: number }) {
  const idx=AQI_LEVELS.findIndex(l=>current<=l.max);
  return <div style={{display:"flex",gap:3,height:28}}>{AQI_LEVELS.map((l,i)=><div key={i} title={`${l.label} (0-${l.max})`} style={{flex:1,borderRadius:6,background:l.color,opacity:i===idx?1:0.15,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:i===idx?`0 0 10px ${l.color}`:"none",transition:"all .5s"}}>{i===idx&&<div style={{width:5,height:5,background:"white",borderRadius:"50%"}}/>}</div>)}</div>;
}

function RateLimit({ rem, onRetry, ready }: { rem: number; onRetry: () => void; ready: boolean }) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"48px 24px",gap:16,textAlign:"center"}}>
      <div style={{fontSize:52}}>⏳</div>
      <div style={{fontSize:20,fontWeight:800,color:"#eab308"}}>Rate Limit Reached</div>
      <div style={{fontSize:13,color:"#6b7280",lineHeight:1.8}}>Auto-retrying shortly...</div>
      {!ready
        ?<div style={{position:"relative",width:100,height:100}}><svg viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="42" fill="none" stroke="#16213e" strokeWidth="7"/><circle cx="50" cy="50" r="42" fill="none" stroke="#eab308" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(rem/COOLDOWN_SEC)*263.8} 263.8`} transform="rotate(-90 50 50)" style={{transition:"stroke-dasharray 1s linear",filter:"drop-shadow(0 0 6px #eab308)"}}/></svg><div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,fontWeight:900,color:"#eab308",fontFamily:"monospace"}}>{rem}s</div></div>
        :<button onClick={onRetry} style={{background:"#eab308",color:"#000",border:"none",borderRadius:12,padding:"14px 40px",cursor:"pointer",fontSize:16,fontWeight:800}}>⟳ Retry Now</button>
      }
    </div>
  );
}

function EmptyState({ onDetect }: { onDetect: () => void }) {
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:24,padding:40,textAlign:"center"}}>
      <div style={{fontSize:72}}>🌍</div>
      <div>
        <div style={{fontSize:28,fontWeight:900,background:"linear-gradient(90deg,#60a5fa,#34d399)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:8}}>AtmoPulse</div>
        <div style={{fontSize:15,color:"#6b7280",lineHeight:1.7,maxWidth:360}}>Real-time AQI</div>
      </div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",justifyContent:"center"}}>
        <button onClick={onDetect} style={{background:"linear-gradient(135deg,#3b82f6,#1d4ed8)",border:"none",borderRadius:14,color:"white",padding:"14px 28px",cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",gap:8}}>📍 Detect My Location</button>
        <div style={{fontSize:13,color:"#374151",display:"flex",alignItems:"center"}}>or search a city above ↑</div>
      </div>
      <div style={{display:"flex",gap:20,marginTop:8,flexWrap:"wrap",justifyContent:"center"}}>
        {[["🏭","Multi-source"],["⚡","Live updates"],["🔔","AQI alerts"],["🗺️","Map"],["🕘","History"],["📤","Share"]].map(([icon,label])=><div key={label} style={{textAlign:"center"}}><div style={{fontSize:24,marginBottom:4}}>{icon}</div><div style={{fontSize:10,color:"#374151"}}>{label}</div></div>)}
      </div>
    </div>
  );
}

function MobileNav({ tabs, activeTab, onSelect, info }: { tabs: any[]; activeTab: string; onSelect: (id: string) => void; info: any }) {
  const mainTabs = tabs.slice(0, 5);
  return (
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#08081a",borderTop:"1px solid #1a1a2e",display:"flex",zIndex:1000,paddingBottom:"env(safe-area-inset-bottom)"}}>
      {mainTabs.map(t=>(
        <button key={t.id} onClick={()=>onSelect(t.id)} style={{flex:1,background:"transparent",border:"none",borderTop:activeTab===t.id?`2px solid ${info?.color||"#3b82f6"}`:"2px solid transparent",color:activeTab===t.id?info?.color||"#3b82f6":"#4b5563",padding:"8px 4px 6px",cursor:"pointer",fontSize:9,fontWeight:activeTab===t.id?700:400,display:"flex",flexDirection:"column",alignItems:"center",gap:2,transition:"all .2s",position:"relative"}}>
          <span style={{fontSize:18}}>{t.icon}</span>
          <span style={{fontSize:9,whiteSpace:"nowrap"}}>{t.label}</span>
          {t.badge>0&&<span style={{position:"absolute",top:4,right:"50%",transform:"translateX(120%)",background:"#ef4444",color:"white",borderRadius:"50%",width:14,height:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:800}}>{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [airData,setAirData]         = useState<any>(null);
  const [allPolls,setAllPolls]       = useState<Record<string,number>>({});
  const [sources,setSources]         = useState<Record<string,string>>({});
  const [err,setErr]                 = useState<string|null>(null);
  const [limited,setLimited]         = useState(false);
  const [loading,setLoading]         = useState(false);
  const [updated,setUpdated]         = useState<Date|null>(null);
  const [hist,setHist]               = useState<any[]>([]);
  const [tab,setTab]                 = useState("dashboard");
  const [showAuth,setShowAuth]       = useState(false);
  const [newKeyName,setNewKeyName]   = useState("");
  const [copied,setCopied]           = useState("");
  const [pollCat,setPollCat]         = useState("All");
  const [dataSource,setDataSource]   = useState<string|null>(null);
  const [hasSearched,setHasSearched] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isMobile    = useIsMobile();
  const cd          = useCooldown(COOLDOWN_SEC);
  const auth        = useAuth();
  const aqi         = airData?.aqi as number|null;
  const alertHook   = useAlerts(aqi, airData?.city);
  const { history: searchHistory, addSearch, clearHistory } = useSearchHistory();

  const fetchWAQI = useCallback(async (lat: number|null, lon: number|null, waqiUid: any, cityName: string|null)=>{
    let url: string;
    if(waqiUid) url=`https://api.waqi.info/feed/@${waqiUid}/?token=${WAQI_TOKEN}`;
    else if(lat&&lon) url=`https://api.waqi.info/feed/geo:${lat};${lon}/?token=${WAQI_TOKEN}`;
    else if(cityName) url=`https://api.waqi.info/feed/${encodeURIComponent(cityName)}/?token=${WAQI_TOKEN}`;
    else throw new Error("No location provided");
    const r=await fetch(url),j=await r.json();
    if(j.status!=="ok") throw new Error(String(j.data)||"WAQI error");
    return parseWAQI(j);
  },[]);

  const fetchIPLocation = useCallback(async ()=>{
    try{const r=await fetch("https://ipapi.co/json/");const j=await r.json();if(j.latitude&&j.longitude)return{lat:j.latitude,lon:j.longitude,city:j.city};}catch{}
    try{const r=await fetch("https://ip-api.com/json/");const j=await r.json();if(j.lat&&j.lon)return{lat:j.lat,lon:j.lon,city:j.city};}catch{}
    return null;
  },[]);

  const fetchOpenAQ = useCallback(async (lat: number, lon: number)=>{
    if(!lat||!lon) return {};
    try{
      const r=await fetch(`https://api.openaq.org/v2/latest?coordinates=${lat},${lon}&radius=25000&limit=100`,{headers:{accept:"application/json"}});
      if(!r.ok) return {};
      const j=await r.json();
      return parseOpenAQ(j.results?.flatMap((s: any)=>s.measurements||[])||[]);
    }catch{return {};}
  },[]);


  const reverseGeocode = useCallback(async (lat: number, lon: number): Promise<string|null> => {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&zoom=16`,
        { headers: { "Accept-Language": "en" } }
      );
      const j = await r.json();
      const a = j.address || {};
      // Build a "Neighbourhood, City" style label for precision
      const locality = a.neighbourhood || a.suburb || a.quarter || a.hamlet || a.village || a.town || null;
      const city     = a.city || a.town || a.village || a.county || a.state_district || null;
      if (locality && city && locality !== city) return `${locality}, ${city}`;
      return city || locality || a.state || null;
    } catch {
      return null;
    }
  }, []);

  const doLoad = useCallback(async (lat: number|null, lon: number|null, waqiUid: any, cityName: string|null)=>{
    setLoading(true);setErr(null);setLimited(false);setHasSearched(true);
    try{
      let unified: any=null,openAQPolls: Record<string,number>={},srcMap: Record<string,string>={};
      if(!lat&&!lon&&!waqiUid&&!cityName){
        throw new Error("No location provided. Please search a city or allow location access.");
      }
      try{
        unified=await fetchWAQI(lat,lon,waqiUid,cityName);
        setDataSource("waqi");
        Object.keys(unified.pollutants||{}).forEach((k: string)=>srcMap[k]="WAQI");
        if(unified.lat&&!lat)lat=unified.lat;
        if(unified.lon&&!lon)lon=unified.lon;
      }catch(e: any){
        const msg=String(e?.message||"").toLowerCase();
        if(msg.includes("rate")||msg.includes("limit")||msg.includes("too many")){setLimited(true);cd.start();return;}
        throw new Error("Could not fetch air quality data. Please try a different city or check your connection.");
      }
      try{
        const al=lat||unified?.lat,alon=lon||unified?.lon;
        if(al&&alon){openAQPolls=await fetchOpenAQ(al,alon);Object.keys(openAQPolls).forEach((k: string)=>srcMap[k]="OpenAQ");}
      }catch{}
      const merged={...(unified?.pollutants||{}),...openAQPolls};
      const fLat=lat||unified?.lat||null,fLon=lon||unified?.lon||null;
      // Always reverse-geocode real coordinates so the displayed name is the actual
      // place — not a WAQI monitoring station name or a vague search suggestion label.
      let fCity = cityName || "Unknown";
      if (fLat && fLon) {
        const rgName = await reverseGeocode(fLat, fLon);
        if (rgName) fCity = rgName;
      }
      setAirData({...unified,lat:fLat,lon:fLon,city:fCity});
      setAllPolls(merged);setSources(srcMap);
      const now=new Date();setUpdated(now);
      if(unified.aqi!=null&&!isNaN(unified.aqi)){
        setHist(p=>[...p.slice(-19),{aqi:unified.aqi,time:now.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}]);
        addSearch(fCity,fLat,fLon,unified.aqi);
      }
    }catch(e: any){setErr(e.message||"Failed to fetch air quality data");}
    finally{setLoading(false);cd.start();}
  },[fetchWAQI,fetchOpenAQ,cd,addSearch,reverseGeocode]);

  const nearest=useCallback(()=>{
    if(!cd.ready) return;
    if(!navigator.geolocation){
      setErr("Geolocation not supported by your browser. Please search your city manually.");
      return;
    }
    setLoading(true);
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      pos=>{
        doLoad(pos.coords.latitude, pos.coords.longitude, null, null);
      },
      (e)=>{
        setLoading(false);
        if(e.code===e.PERMISSION_DENIED)
          setErr("Location access denied. Please allow location permission in your browser, or search your city manually.");
        else if(e.code===e.POSITION_UNAVAILABLE)
          setErr("Location unavailable. Please search your city manually.");
        else
          setErr("Location request timed out. Please search your city manually.");
      },
      {timeout:15000,enableHighAccuracy:true,maximumAge:0}
    );
  },[cd.ready,doLoad]);

  const handleSearch=useCallback((s: any)=>{
    if(!s){nearest();return;}if(!cd.ready)return;
    if(s.waqiUid) doLoad(s.lat||null,s.lon||null,s.waqiUid,s.city||s.label);
    else if(s.lat!=null&&s.lon!=null) doLoad(s.lat,s.lon,null,s.city||s.label);
    else if(s.label) doLoad(null,null,null,s.label);
  },[nearest,doLoad,cd.ready]);

  useEffect(()=>{if(limited&&cd.ready)nearest();},[cd.ready,limited]);

  const info        = aqi!=null?getInfo(aqi):null;
  const pollEntries = Object.entries(allPolls).filter(([k])=>POLL_META[k]&&(pollCat==="All"||POLL_META[k].cat===pollCat));
  const copyKey     = (k: string)=>{navigator.clipboard?.writeText(k).catch(()=>{});setCopied(k);setTimeout(()=>setCopied(""),2000);};
  const tips = aqi==null?[]:aqi<=50?["Perfect for all outdoor activities","Great time for exercise","Open windows freely","No precautions needed"]:aqi<=100?["Safe for most people","Sensitive individuals limit exertion","Good for light outdoor activity","Keep windows open"]:aqi<=150?["Limit prolonged outdoor exertion","Children & elderly reduce outdoor time","Consider wearing a mask","Keep indoor air clean"]:aqi<=200?["Everyone limit outdoor exertion","Wear N95 mask outdoors","Keep windows closed","Use air purifier indoors"]:aqi<=300?["Avoid all outdoor activities","Stay indoors with purifier","Seal window gaps","See doctor if symptoms"]:["Emergency — stay indoors","Do not go outside","Seal all ventilation","Call doctor immediately"];

  const TABS=[
    {id:"dashboard",label:"Dashboard",icon:"⚡"},
    {id:"map",      label:"Map",      icon:"🗺️"},
    {id:"air",      label:"Pollutants",icon:"🏭"},
    {id:"health",   label:"Health",   icon:"💊"},
    {id:"trend",    label:"Trend",    icon:"📈"},
    {id:"history",  label:"History",  icon:"🕘"},
    {id:"alerts",   label:"Alerts",   icon:"🔔",badge:alertHook.alerts.length},
    {id:"api",      label:"API Keys", icon:"🔑"},
  ];

  const moreTabIds = ["trend","history","alerts","api"];

  return (
    <div style={{height:"100dvh",width:"100vw",background:"#06060f",color:"#e2e8f0",fontFamily:"'Segoe UI',system-ui,sans-serif",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {showAuth&&<AuthModal onClose={()=>setShowAuth(false)} auth={auth}/>}

      {/* ── HEADER ── */}
      <div style={{background:"#08081a",borderBottom:"1px solid #1a1a2e",padding:isMobile?"0 12px":"0 20px",display:"flex",alignItems:"center",gap:isMobile?8:12,height:isMobile?50:54,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
          <div>🌍</div>
          {!isMobile&&<div>
            <div style={{fontSize:14,fontWeight:800,letterSpacing:-0.5,background:"linear-gradient(90deg,#60a5fa,#34d399)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>AtmoPulse</div>
            <div style={{fontSize:8,color:"#374151",letterSpacing:2,marginTop:-2}}>REAL TIME AQI</div>
          </div>}
        </div>
        <div style={{flex:1,maxWidth:isMobile?"100%":460}}><Search onSearch={handleSearch} loading={loading}/></div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:isMobile?6:10,flexShrink:0}}>
          {!isMobile&&alertHook.alerts.length>0&&<div style={{background:"#ef444422",border:"1px solid #ef444444",borderRadius:8,padding:"4px 10px",fontSize:11,color:"#f87171",cursor:"pointer"}} onClick={()=>setTab("alerts")}>🔔 {alertHook.alerts.length}</div>}
          {info&&aqi!=null&&<div style={{background:info.bg,border:`1px solid ${info.color}44`,borderRadius:10,padding:isMobile?"3px 8px":"5px 12px",textAlign:"center",flexShrink:0}}><div style={{fontSize:isMobile?14:18,fontWeight:900,color:info.color,fontFamily:"monospace",lineHeight:1}}>{aqi}</div>{!isMobile&&<div style={{fontSize:8,color:info.color,letterSpacing:1}}>{info.label}</div>}</div>}
          {!isMobile&&updated&&<div style={{fontSize:9,color:"#374151",textAlign:"right",lineHeight:1.5}}><div>{updated.toLocaleTimeString()}</div></div>}

          {/* ── SHARE BUTTON — appears in header when data is loaded ── */}
          {airData && aqi != null && info && (
            <ShareButton
              airData={airData}
              aqi={aqi}
              info={info}
              allPolls={allPolls}
              isMobile={isMobile}
            />
          )}

          <button onClick={airData?()=>{if(cd.ready)doLoad(airData.lat,airData.lon,null,airData.city);}:nearest} disabled={loading||!cd.ready||!hasSearched} style={{background:(cd.ready&&hasSearched)?"#0f172a":"transparent",border:`1px solid ${(cd.ready&&hasSearched)?"#1e3a5f":"#1a1a2e"}`,borderRadius:10,color:(cd.ready&&hasSearched)?"#60a5fa":"#374151",padding:isMobile?"6px 8px":"7px 12px",cursor:(cd.ready&&hasSearched)?"pointer":"not-allowed",fontSize:isMobile?11:12,fontWeight:600,whiteSpace:"nowrap",transition:"all .2s"}}>
            {loading?"⟳":!cd.ready?`${cd.rem}s`:"⟳"}
          </button>
          {auth.user
            ?<div style={{display:"flex",alignItems:"center",gap:6}}>
               <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#3b82f6,#a855f7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,cursor:"pointer"}} onClick={()=>setTab("api")}>{auth.user.name?.[0]?.toUpperCase()||"U"}</div>
               {!isMobile&&<button onClick={auth.logout} style={{background:"transparent",border:"1px solid #1a1a2e",borderRadius:8,color:"#4b5563",padding:"6px 10px",cursor:"pointer",fontSize:11}}>Out</button>}
             </div>
            :<button onClick={()=>setShowAuth(true)} style={{background:"linear-gradient(135deg,#3b82f6,#1d4ed8)",border:"none",borderRadius:10,color:"white",padding:isMobile?"6px 10px":"7px 14px",cursor:"pointer",fontSize:isMobile?11:12,fontWeight:700,flexShrink:0}}>Sign In</button>
          }
        </div>
      </div>

      {/* ── DESKTOP TAB BAR ── */}
      {!isMobile&&(
        <div style={{background:"#08081a",borderBottom:"1px solid #1a1a2e",padding:"0 20px",display:"flex",gap:0,flexShrink:0,overflowX:"auto"}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"transparent",border:"none",borderBottom:tab===t.id?`2px solid ${info?.color||"#3b82f6"}`:"2px solid transparent",color:tab===t.id?info?.color||"#3b82f6":"#4b5563",padding:"10px 16px",cursor:"pointer",fontSize:12,fontWeight:tab===t.id?700:400,transition:"all .2s",display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap",position:"relative"}}>
              {t.icon} {t.label}
              {(t as any).badge>0&&<span style={{background:"#ef4444",color:"white",borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800}}>{(t as any).badge}</span>}
            </button>
          ))}
          {airData&&<div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,padding:"0 4px",flexShrink:0}}>
            <span style={{fontSize:10,color:"#374151",whiteSpace:"nowrap"}}>📍 {airData.city}</span>
            {airData.attributions?.slice(0,1).map((a: any,i: number)=><a key={i} href={a.url} target="_blank" rel="noreferrer" style={{fontSize:9,color:"#1e3a5f",textDecoration:"none"}}>via {a.name?.split(" ")[0]}</a>)}
          </div>}
        </div>
      )}

      {/* ── MOBILE SECONDARY TABS ── */}
      {isMobile&&moreTabIds.includes(tab)&&(
        <div style={{background:"#08081a",borderBottom:"1px solid #1a1a2e",padding:"0 12px",display:"flex",gap:0,flexShrink:0,overflowX:"auto"}}>
          {TABS.filter(t=>moreTabIds.includes(t.id)).map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"transparent",border:"none",borderBottom:tab===t.id?`2px solid ${info?.color||"#3b82f6"}`:"2px solid transparent",color:tab===t.id?info?.color||"#3b82f6":"#4b5563",padding:"8px 12px",cursor:"pointer",fontSize:11,fontWeight:tab===t.id?700:400,display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}>
              {t.icon} {t.label}
              {(t as any).badge>0&&<span style={{background:"#ef4444",color:"white",borderRadius:"50%",width:14,height:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:800}}>{(t as any).badge}</span>}
            </button>
          ))}
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <div style={{flex:1,overflow:"auto",padding:isMobile?10:16,display:"flex",flexDirection:"column",gap:isMobile?10:16,paddingBottom:isMobile?70:16}}>

        {tab==="history"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:isMobile?14:16,fontWeight:700}}>🕘 Search History <span style={{fontSize:11,color:"#4b5563",fontWeight:400}}>({searchHistory.length})</span></div>
              {searchHistory.length>0&&<button onClick={clearHistory} style={{background:"transparent",border:"1px solid #374151",borderRadius:8,color:"#6b7280",padding:"5px 14px",cursor:"pointer",fontSize:11}}>Clear All</button>}
            </div>
            {searchHistory.length===0
              ?<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,padding:"60px 0",textAlign:"center",color:"#374151"}}>
                 <div style={{fontSize:48}}>🔍</div>
                 <div style={{fontSize:15,fontWeight:600,color:"#4b5563"}}>No searches yet</div>
                 <div style={{fontSize:13}}>Search any city and it will appear here</div>
               </div>
              :<div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
                {searchHistory.map((s: any,i: number)=>{
                  const si=s.aqi?getInfo(s.aqi):null;
                  return(
                    <div key={i} onClick={()=>handleSearch({label:s.city,city:s.city,lat:s.lat,lon:s.lon,type:"geo",waqiUid:null})} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:"#0a0a14",borderRadius:14,border:`1px solid ${si?si.color+"22":"#1a1a2e"}`,cursor:"pointer",transition:"all .15s"}}>
                      <div style={{width:36,height:36,borderRadius:"50%",background:si?si.bg:"#1a1a2e",border:`2px solid ${si?si.color+"55":"#1e2035"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontSize:16}}>📍</span></div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.city}</div>
                        <div style={{fontSize:9,color:"#374151",marginTop:2}}>{new Date(s.searched_at).toLocaleDateString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</div>
                      </div>
                      {s.aqi!=null&&si&&<div style={{textAlign:"center",flexShrink:0}}><div style={{fontSize:18,fontWeight:900,color:si.color,fontFamily:"monospace",lineHeight:1}}>{s.aqi}</div><div style={{fontSize:8,color:si.color,letterSpacing:1}}>{si.label}</div></div>}
                    </div>
                  );
                })}
              </div>
            }
          </div>
        )}

        {!hasSearched&&!loading&&tab!=="history"&&<EmptyState onDetect={nearest}/>}
        {loading&&!airData&&hasSearched&&<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,color:"#374151"}}><div style={{fontSize:56,animation:"spin 1s linear infinite"}}>⟳</div><div style={{fontSize:16}}>Fetching live data...</div></div>}
        {limited&&!loading&&<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:20,width:isMobile?"100%":380}}><RateLimit rem={cd.rem} onRetry={nearest} ready={cd.ready}/></div></div>}
        {err&&!loading&&!limited&&<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:"#0a0a14",border:"1px solid #7f1d1d",borderRadius:20,padding:"40px 32px",textAlign:"center",maxWidth:420,width:"100%"}}><div style={{fontSize:44,marginBottom:12}}>⚠️</div><div style={{color:"#fca5a5",fontSize:14,marginBottom:16,lineHeight:1.6}}>{err}</div><button onClick={nearest} style={{background:"#ef4444",color:"white",border:"none",borderRadius:10,padding:"10px 24px",cursor:"pointer",fontSize:14,fontWeight:700}}>Try Again</button></div></div>}

        {airData&&aqi!=null&&info&&!limited&&<>
          {tab==="dashboard"&&(
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"300px 1fr",gap:isMobile?10:14}}>
              {/* AQI Card */}
              <div style={{background:info.bg,border:`1px solid ${info.color}33`,borderRadius:20,padding:isMobile?"16px":"22px 20px",display:"flex",flexDirection:"column",alignItems:"center",gap:isMobile?8:10,boxShadow:`0 0 60px ${info.color}10`}}>
                <div style={{fontSize:10,color:"#4b5563",letterSpacing:3,textTransform:"uppercase"}}>US EPA Air Quality Index</div>
                <Gauge value={aqi}/>
                <div style={{fontSize:isMobile?16:20,fontWeight:900,color:info.color,textShadow:`0 0 16px ${info.color}88`}}>{info.label}</div>
                <div style={{fontSize:11,color:"#6b7280",textAlign:"center",lineHeight:1.6,maxWidth:230}}>{info.desc}</div>
                <div style={{width:"100%"}}><AQIScale current={aqi}/><div style={{display:"flex",justifyContent:"space-between",marginTop:3}}><span style={{fontSize:8,color:"#374151"}}>0 Good</span><span style={{fontSize:8,color:"#374151"}}>500 Hazardous</span></div></div>
                {airData.dominantPol&&<div style={{width:"100%",background:"#0a0a14",border:`1px solid ${info.color}22`,borderRadius:10,padding:"8px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:10,color:"#4b5563",letterSpacing:1,textTransform:"uppercase"}}>Dominant</span><span style={{fontSize:13,fontWeight:800,color:info.color,fontFamily:"monospace"}}>{POLL_META[airData.dominantPol]?.name||airData.dominantPol?.toUpperCase()}</span></div>}
              </div>
              {/* Map */}
              <div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:20,overflow:"hidden",minHeight:isMobile?220:320}}><LiveMap lat={airData.lat} lon={airData.lon} city={airData.city} aqi={aqi}/></div>
              {/* Weather grid */}
              <div style={{gridColumn:"1 / -1",display:"grid",gridTemplateColumns:isMobile?"repeat(3,1fr)":"repeat(6,1fr)",gap:isMobile?8:10}}>
                {[{k:"t",icon:"🌡️",label:"Temp"},{k:"h",icon:"💧",label:"Humidity"},{k:"w",icon:"💨",label:"Wind"},{k:"p",icon:"🔵",label:"Pressure"},{k:"dew",icon:"💦",label:"Dew Pt"},{k:"wg",icon:"🌬️",label:"Gust"}].map(({k,icon,label})=>(
                  <div key={k} style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:14,padding:isMobile?"10px 12px":"14px 16px"}}>
                    <div style={{fontSize:isMobile?18:22,marginBottom:4}}>{icon}</div>
                    <div style={{fontSize:isMobile?8:9,color:"#4b5563",letterSpacing:2,textTransform:"uppercase",marginBottom:2}}>{label}</div>
                    <div style={{fontSize:isMobile?14:20,fontWeight:800,color:"#e2e8f0",fontFamily:"monospace"}}>{allPolls[k]!=null?allPolls[k]:<span style={{color:"#374151"}}>—</span>}<span style={{fontSize:9,color:"#4b5563",marginLeft:2}}>{POLL_META[k]?.unit}</span></div>
                  </div>
                ))}
              </div>
              {hist.length>=2&&<div style={{gridColumn:"1 / -1",background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:16,padding:"16px 20px"}}><div style={{fontSize:10,color:"#374151",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>📈 Session AQI Trend</div><Sparkline history={hist}/></div>}
            </div>
          )}

          {tab==="map"&&(
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 260px",gap:14,flex:1,minHeight:isMobile?400:500}}>
              <div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:20,overflow:"hidden",minHeight:isMobile?300:400}}><LiveMap lat={airData.lat} lon={airData.lon} city={airData.city} aqi={aqi}/></div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:16,padding:16}}>
                  <div style={{fontSize:10,color:"#374151",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>📍 Station Info</div>
                  {[["Station",airData.station||airData.city],["Lat",airData.lat?.toFixed(4)],["Lon",airData.lon?.toFixed(4)],["Updated",airData.updated?new Date(airData.updated).toLocaleTimeString():null],["Source",dataSource?.toUpperCase()]].filter(([,v])=>v).map(([k,v])=>(
                    <div key={k as string} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #0f0f1a"}}><span style={{fontSize:11,color:"#4b5563"}}>{k}</span><span style={{fontSize:11,color:"#94a3b8",fontFamily:"monospace",textAlign:"right",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v as string}</span></div>
                  ))}
                </div>
                {airData.attributions?.length>0&&<div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:16,padding:16}}><div style={{fontSize:10,color:"#374151",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>🏛️ Data Providers</div>{airData.attributions.map((a: any,i: number)=><div key={i} style={{padding:"5px 0",borderBottom:i<airData.attributions.length-1?"1px solid #0f0f1a":"none"}}><a href={a.url} target="_blank" rel="noreferrer" style={{fontSize:11,color:"#60a5fa",textDecoration:"none"}}>{a.name}</a></div>)}</div>}
                <div style={{background:info.bg,border:`1px solid ${info.color}33`,borderRadius:16,padding:16}}><div style={{fontSize:44,fontWeight:900,color:info.color,fontFamily:"monospace",textShadow:`0 0 20px ${info.color}`}}>{aqi}</div><div style={{fontSize:13,color:info.color,marginTop:4}}>{info.label}</div><div style={{marginTop:10}}><AQIScale current={aqi}/></div></div>
              </div>
            </div>
          )}

          {tab==="air"&&(
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{background:"#0a0a14",border:`1px solid ${info.color}33`,borderRadius:16,padding:isMobile?"12px 14px":"16px 20px",display:"flex",alignItems:"center",gap:isMobile?12:24,flexWrap:"wrap"}}>
                <div><div style={{fontSize:9,color:"#4b5563",letterSpacing:2,textTransform:"uppercase"}}>US AQI</div><div style={{fontSize:isMobile?36:48,fontWeight:900,color:info.color,fontFamily:"monospace",lineHeight:1}}>{aqi}</div></div>
                <div style={{marginLeft:"auto",textAlign:"right"}}><div style={{fontSize:isMobile?13:15,fontWeight:800,color:info.color}}>{info.label}</div><div style={{fontSize:11,color:"#6b7280",marginTop:4,maxWidth:300}}>{info.desc}</div><div style={{display:"flex",gap:6,marginTop:8,justifyContent:"flex-end",flexWrap:"wrap"}}>{[...new Set(Object.values(sources))].map((s: any)=><span key={s} style={{fontSize:10,background:s==="WAQI"?"#22c55e22":s==="OpenAQ"?"#3b82f622":"#eab30822",color:s==="WAQI"?"#22c55e":s==="OpenAQ"?"#60a5fa":"#eab308",borderRadius:6,padding:"3px 10px",fontWeight:600}}>✓ {s}</span>)}</div></div>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {POLL_CATS.map(c=><button key={c} onClick={()=>setPollCat(c)} style={{background:pollCat===c?info.color+"22":"#0a0a14",border:`1px solid ${pollCat===c?info.color+"55":"#1a1a2e"}`,borderRadius:20,color:pollCat===c?info.color:"#4b5563",padding:"6px 14px",cursor:"pointer",fontSize:isMobile?10:11,fontWeight:pollCat===c?700:400,transition:"all .2s"}}>{c}{c!=="All"&&<span style={{color:"#374151"}}> ({Object.entries(allPolls).filter(([k])=>POLL_META[k]?.cat===c).length})</span>}</button>)}
                <span style={{marginLeft:"auto",fontSize:11,color:"#374151",display:"flex",alignItems:"center"}}>{pollEntries.length} readings</span>
              </div>
              {pollEntries.length>0
                ?<div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>{pollEntries.map(([k,v])=><PollCard key={k} pkey={k} value={v} isMajor={airData.dominantPol===k} source={sources[k]||"—"}/>)}</div>
                :<div style={{textAlign:"center",padding:"48px 0",color:"#374151"}}><div style={{fontSize:32,marginBottom:8}}>🔬</div><div style={{fontSize:13}}>No {pollCat} data available</div></div>
              }
            </div>
          )}

          {tab==="health"&&(
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14,alignContent:"start"}}>
              <div style={{background:info.bg,border:`1px solid ${info.color}44`,borderRadius:20,padding:isMobile?16:24,display:"flex",flexDirection:"column",alignItems:"center",gap:12,textAlign:"center"}}>
                <div style={{fontSize:isMobile?48:64}}>{aqi<=50?"😊":aqi<=100?"😐":aqi<=150?"😷":aqi<=200?"🤧":aqi<=300?"😰":"🆘"}</div>
                <div style={{fontSize:isMobile?18:22,fontWeight:900,color:info.color}}>{info.label}</div>
                <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.7,maxWidth:240}}>{info.desc}</div>
                <div style={{background:"#0a0a14",borderRadius:12,padding:"10px 24px",width:"100%"}}><div style={{fontSize:9,color:"#4b5563",letterSpacing:2,textTransform:"uppercase"}}>Current AQI</div><div style={{fontSize:42,fontWeight:900,color:info.color,fontFamily:"monospace"}}>{aqi}</div></div>
                <div style={{width:"100%"}}><AQIScale current={aqi}/></div>
              </div>
              <div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:20,padding:20}}>
                <div style={{fontSize:10,color:"#374151",letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>👥 Risk by Group</div>
                {[{g:"👶 Children",risk:aqi>100,high:aqi>150},{g:"👴 Elderly",risk:aqi>100,high:aqi>150},{g:"🏃 Athletes",risk:aqi>50,high:aqi>100},{g:"🫀 Heart",risk:aqi>50,high:aqi>100},{g:"🫁 Lung",risk:aqi>50,high:aqi>100},{g:"🤰 Pregnant",risk:aqi>50,high:aqi>100},{g:"🧑 General",risk:aqi>150,high:aqi>200},{g:"👁️ Eyes",risk:aqi>100,high:aqi>150}].map((r,i,a)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:i<a.length-1?"1px solid #0f0f1a":"none"}}><span style={{fontSize:isMobile?11:12,color:"#94a3b8"}}>{r.g}</span><span style={{fontSize:isMobile?10:11,fontWeight:700,color:r.high?"#ef4444":r.risk?"#eab308":"#22c55e",background:r.high?"#ef444411":r.risk?"#eab30811":"#22c55e11",borderRadius:6,padding:"3px 8px"}}>{r.high?"⚠️ High":r.risk?"🔶 Moderate":"✅ Safe"}</span></div>
                ))}
              </div>
              <div style={{gridColumn:"1 / -1",background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:20,padding:20}}>
                <div style={{fontSize:10,color:"#374151",letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>💡 Recommendations</div>
                <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:10}}>{tips.map((tip,i)=><div key={i} style={{background:"#06060f",border:`1px solid ${info.color}22`,borderRadius:12,padding:"12px 16px",fontSize:isMobile?12:13,color:"#94a3b8",display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:isMobile?16:20,flexShrink:0}}>{tip.split(" ")[0]}</span><span style={{lineHeight:1.5}}>{tip.split(" ").slice(1).join(" ")}</span></div>)}</div>
              </div>
            </div>
          )}

          {tab==="trend"&&(
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:20,padding:isMobile?16:24}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
                  <div><div style={{fontSize:isMobile?14:16,fontWeight:700}}>AQI Trend — {airData.city}</div><div style={{fontSize:11,color:"#4b5563",marginTop:2}}>{hist.length} readings</div></div>
                  {hist.length>0&&<div style={{display:"flex",gap:isMobile?12:20}}>{[["Min",Math.min(...hist.map((h: any)=>h.aqi))],["Avg",Math.round(hist.reduce((a: number,b: any)=>a+b.aqi,0)/hist.length)],["Max",Math.max(...hist.map((h: any)=>h.aqi))]].map(([l,v])=><div key={l as string} style={{textAlign:"center"}}><div style={{fontSize:9,color:"#374151",letterSpacing:2,textTransform:"uppercase"}}>{l}</div><div style={{fontSize:isMobile?18:24,fontWeight:900,color:getInfo(v as number).color,fontFamily:"monospace"}}>{v}</div></div>)}</div>}
                </div>
                <Sparkline history={hist}/>
              </div>
              {hist.length>0&&<div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:20,padding:20}}>
                <div style={{fontSize:10,color:"#374151",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Reading Log</div>
                <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:300,overflowY:"auto"}}>
                  {[...hist].reverse().map((h: any,i: number)=>{const hi=getInfo(h.aqi);return<div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 12px",background:"#06060f",borderRadius:10,border:"1px solid #0f0f1a"}}><div style={{width:8,height:8,borderRadius:"50%",background:hi.color,boxShadow:`0 0 4px ${hi.color}`,flexShrink:0}}/><span style={{fontSize:11,color:"#374151",fontFamily:"monospace",width:60}}>{h.time}</span><span style={{fontSize:16,fontWeight:800,color:hi.color,fontFamily:"monospace",width:50}}>{h.aqi}</span><span style={{fontSize:11,color:hi.color}}>{hi.label}</span></div>;})}
                </div>
              </div>}
            </div>
          )}

          {tab==="alerts"&&(
            <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 300px",gap:14,alignContent:"start"}}>
              <div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:20,padding:20}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <div style={{fontSize:15,fontWeight:700}}>🔔 Alert Log</div>
                  {alertHook.alerts.length>0&&<button onClick={alertHook.clearAlerts} style={{background:"transparent",border:"1px solid #374151",borderRadius:8,color:"#6b7280",padding:"5px 12px",cursor:"pointer",fontSize:11}}>Clear All</button>}
                </div>
                {alertHook.alerts.length===0
                  ?<div style={{textAlign:"center",padding:"40px 0",color:"#374151"}}><div style={{fontSize:40,marginBottom:10}}>🔕</div><div>No alerts yet. Set a threshold below and refresh.</div></div>
                  :<div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:420,overflowY:"auto"}}>{alertHook.alerts.map((a: any)=><div key={a.id} style={{background:"#06060f",border:`1px solid ${a.color}33`,borderRadius:12,padding:"12px 16px",display:"flex",gap:12,alignItems:"flex-start"}}><div style={{width:8,height:8,borderRadius:"50%",background:a.color,marginTop:5,flexShrink:0}}/><div style={{flex:1}}><div style={{fontSize:13,color:"#e2e8f0",lineHeight:1.5}}>{a.msg}</div><div style={{fontSize:10,color:"#374151",marginTop:3}}>{a.time}</div></div><div style={{fontSize:18,fontWeight:900,color:a.color,fontFamily:"monospace"}}>{a.aqi}</div></div>)}</div>
                }
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:20,padding:20}}>
                  <div style={{fontSize:10,color:"#374151",letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>⚙️ Alert Settings</div>
                  <div style={{fontSize:12,color:"#94a3b8",marginBottom:8}}>AQI Threshold</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>{[50,100,150,200,300].map(v=><button key={v} onClick={()=>alertHook.setThreshold(v)} style={{flex:1,minWidth:44,background:alertHook.threshold===v?getInfo(v).bg:"#06060f",border:`1px solid ${alertHook.threshold===v?getInfo(v).color+"55":"#1a1a2e"}`,borderRadius:8,color:alertHook.threshold===v?getInfo(v).color:"#6b7280",padding:"7px 4px",cursor:"pointer",fontSize:12,fontWeight:alertHook.threshold===v?700:400}}>{v}</button>)}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0",borderTop:"1px solid #1a1a2e",marginTop:8}}>
                    <div style={{fontSize:12,color:"#94a3b8"}}>Push Notifications</div>
                    <button onClick={alertHook.toggleNotif} style={{background:alertHook.notifOn?"#22c55e22":"#06060f",border:`1px solid ${alertHook.notifOn?"#22c55e55":"#374151"}`,borderRadius:20,color:alertHook.notifOn?"#22c55e":"#4b5563",padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:600}}>{alertHook.notifOn?"🔔 ON":"🔕 OFF"}</button>
                  </div>
                </div>
                <div style={{background:info.bg,border:`1px solid ${info.color}33`,borderRadius:20,padding:16}}>
                  <div style={{fontSize:40,fontWeight:900,color:info.color,fontFamily:"monospace"}}>{aqi}</div>
                  <div style={{fontSize:12,color:info.color,marginTop:4}}>{info.label}</div>
                  <div style={{marginTop:10}}><AQIScale current={aqi}/></div>
                  <div style={{fontSize:11,marginTop:8,fontWeight:600,color:aqi>alertHook.threshold?"#ef4444":"#22c55e"}}>{aqi>alertHook.threshold?`⚠️ Above threshold (${alertHook.threshold})`:`✅ Below threshold (${alertHook.threshold})`}</div>
                </div>
              </div>
            </div>
          )}

          {tab==="api"&&(
            !auth.user
              ?<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:24,padding:"60px 40px",textAlign:"center",maxWidth:460,width:"100%"}}><div style={{fontSize:56,marginBottom:16}}>🔑</div><div style={{fontSize:22,fontWeight:800,marginBottom:8}}>API Key Management</div><div style={{fontSize:13,color:"#6b7280",marginBottom:28,lineHeight:1.8}}>Sign in to generate personal API keys.</div><button onClick={()=>setShowAuth(true)} style={{width:"100%",background:"linear-gradient(135deg,#3b82f6,#1d4ed8)",border:"none",borderRadius:12,color:"white",padding:"13px",cursor:"pointer",fontSize:14,fontWeight:700}}>Sign In / Register Free →</button></div></div>
              :<div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 340px",gap:14,alignContent:"start"}}>
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  <div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:20,padding:20}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><div style={{fontSize:15,fontWeight:700}}>🔑 Your API Keys <span style={{fontSize:11,color:"#4b5563",fontWeight:400}}>({(auth.user.apiKeys||[]).length}/10)</span></div></div>
                    {(auth.user.apiKeys||[]).map((k: any)=>(
                      <div key={k.key} style={{background:"#06060f",border:"1px solid #1a1a2e",borderRadius:12,padding:"14px 16px",marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:13,fontWeight:600}}>{k.name}</span><button onClick={()=>auth.deleteKey(k.key)} style={{background:"transparent",border:"1px solid #7f1d1d44",borderRadius:6,color:"#f87171",padding:"3px 10px",cursor:"pointer",fontSize:11}}>Delete</button></div>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}><code style={{flex:1,background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#60a5fa",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k.key}</code><button onClick={()=>copyKey(k.key)} style={{background:copied===k.key?"#22c55e22":"#0f172a",border:`1px solid ${copied===k.key?"#22c55e44":"#1e3a5f"}`,borderRadius:8,color:copied===k.key?"#22c55e":"#60a5fa",padding:"8px 12px",cursor:"pointer",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>{copied===k.key?"✓":"Copy"}</button></div>
                        <div style={{fontSize:10,color:"#374151",marginTop:6}}>Created {new Date(k.created).toLocaleDateString()}</div>
                      </div>
                    ))}
                    {(auth.user.apiKeys||[]).length<10&&<div style={{display:"flex",gap:8,marginTop:4}}><input value={newKeyName} onChange={e=>setNewKeyName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){auth.addKey(newKeyName);setNewKeyName("");}}} placeholder="Key name (e.g. My App)" style={{flex:1,background:"#06060f",border:"1px solid #1e2035",borderRadius:10,color:"#e2e8f0",padding:"10px 14px",fontSize:13,outline:"none",fontFamily:"inherit"}}/><button onClick={()=>{auth.addKey(newKeyName);setNewKeyName("");}} style={{background:"linear-gradient(135deg,#3b82f6,#1d4ed8)",border:"none",borderRadius:10,color:"white",padding:"10px 18px",cursor:"pointer",fontSize:13,fontWeight:700,whiteSpace:"nowrap"}}>+ Add</button></div>}
                  </div>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  <div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:20,padding:20}}>
                    <div style={{fontSize:10,color:"#374151",letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>👤 Account</div>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                      <div style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,#3b82f6,#a855f7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:800}}>{auth.user.name?.[0]?.toUpperCase()||"U"}</div>
                      <div><div style={{fontSize:14,fontWeight:700}}>{auth.user.name}</div><div style={{fontSize:11,color:"#4b5563"}}>{auth.user.email}</div></div>
                    </div>
                    <button onClick={auth.logout} style={{width:"100%",background:"transparent",border:"1px solid #7f1d1d44",borderRadius:10,color:"#f87171",padding:"9px",cursor:"pointer",fontSize:13}}>Sign Out</button>
                  </div>
                  <div style={{background:"linear-gradient(135deg,#0f172a,#1e1b4b)",border:"1px solid #3b82f633",borderRadius:20,padding:20}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>🚀 Quick Start</div>
                    <code style={{display:"block",background:"#06060f",border:"1px solid #1a1a2e",borderRadius:10,padding:"12px",fontSize:10,color:"#4ade80",fontFamily:"monospace",lineHeight:1.9,whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{`// WAQI\nfetch("https://api.waqi.info/feed/here/?token=${WAQI_TOKEN}")\n  .then(r=>r.json())\n  .then(d=>console.log(d.data.aqi));`}</code>
                  </div>
                </div>
              </div>
          )}
        </>}
      </div>

      {/* ── MOBILE BOTTOM NAV ── */}
      {isMobile&&(
        <>
          <MobileNav
            tabs={[
              {id:"dashboard",label:"Home",icon:"⚡"},
              {id:"map",label:"Map",icon:"🗺️"},
              {id:"air",label:"Air",icon:"🏭"},
              {id:"health",label:"Health",icon:"💊"},
              {id:"more",label:"More",icon:"☰",badge:alertHook.alerts.length},
            ]}
            activeTab={moreTabIds.includes(tab)?"more":tab}
            onSelect={(id)=>{
              if(id==="more"){
                setMobileMenuOpen(prev=>!prev);
                if(!moreTabIds.includes(tab)) setTab("trend");
              } else {
                setTab(id);
                setMobileMenuOpen(false);
              }
            }}
            info={info}
          />
          {/* More drawer */}
          {mobileMenuOpen&&(
            <div style={{position:"fixed",bottom:60,left:0,right:0,background:"#0d0d1f",borderTop:"1px solid #1a1a2e",zIndex:999,padding:"12px 16px",display:"flex",gap:8,flexWrap:"wrap"}}>
              {[{id:"trend",label:"Trend",icon:"📈"},{id:"history",label:"History",icon:"🕘"},{id:"alerts",label:"Alerts",icon:"🔔",badge:alertHook.alerts.length},{id:"api",label:"API Keys",icon:"🔑"}].map(t=>(
                <button key={t.id} onClick={()=>{setTab(t.id);setMobileMenuOpen(false);}} style={{flex:"1 0 40%",background:tab===t.id?"#1a1a2e":"#06060f",border:`1px solid ${tab===t.id?info?.color||"#3b82f6":"#1a1a2e"}`,borderRadius:12,color:tab===t.id?info?.color||"#3b82f6":"#94a3b8",padding:"10px 12px",cursor:"pointer",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:8,position:"relative"}}>
                  <span>{t.icon}</span> {t.label}
                  {(t as any).badge>0&&<span style={{background:"#ef4444",color:"white",borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,marginLeft:"auto"}}>{(t as any).badge}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── FOOTER ── */}
      {!isMobile&&(
        <div style={{background:"#08081a",borderTop:"1px solid #1a1a2e",padding:"14px 24px",display:"flex",flexDirection:"column",gap:6,flexShrink:0}}>
          <div style={{fontSize:13,color:"#4b5563"}}>© {new Date().getFullYear()} AtmoPulse. All rights reserved.</div>
          <div style={{fontSize:13,color:"#4b5563"}}>Made with ❤️ & ☕ by <a href="http://ayush-devspace5.web.app" target="_blank" rel="noreferrer" style={{color:"#4b5563",textDecoration:"none"}}>Ayush Devspace</a></div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes mpulse { 0%,100%{opacity:.3;transform:scale(1)} 50%{opacity:.7;transform:scale(1.4)} }
        * { box-sizing: border-box; margin: 0; padding: 0 }
        input::placeholder { color: #374151 }
        input:focus { border-color: #3b82f6 !important; box-shadow: 0 0 0 2px #3b82f622 }
        ::-webkit-scrollbar { width: 4px; height: 4px }
        ::-webkit-scrollbar-track { background: #06060f }
        ::-webkit-scrollbar-thumb { background: #1a1a2e; border-radius: 4px }
        .leaflet-popup-content-wrapper { background: #0d0d1f !important; border: 1px solid #1e2035 !important; color: #e2e8f0 !important; border-radius: 10px !important }
        .leaflet-popup-tip { background: #0d0d1f !important }
        .leaflet-popup-content { color: #e2e8f0 !important; margin: 10px 14px !important }
        @media (max-width: 768px) {
          input { font-size: 16px !important; }
        }
      `}</style>
    </div>
  );
}