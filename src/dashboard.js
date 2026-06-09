/** The Quay dashboard — one self-contained page, same house style as the reading room. */
export function dashboardHtml({ adminHost, scheme, deployHostSuffix, portSuffix = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quay</title>
<link rel="icon" href='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="5" y="13" width="22" height="3" rx="1.5" fill="%238a2d22"/><rect x="8" y="18" width="5" height="9" fill="%238a2d22"/><rect x="19" y="18" width="5" height="9" fill="%238a2d22"/><circle cx="16" cy="7" r="3" fill="none" stroke="%238a2d22" stroke-width="2"/></svg>'>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..600&family=Newsreader:wght@400..600&family=Spline+Sans+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#f4efe4; --surface:#faf6ec; --raise:#fffdf6; --ink:#211b12; --muted:#6e6250; --faint:#9c8f7c;
  --accent:#8a2d22; --line:rgba(33,27,18,.14); --hair:rgba(33,27,18,.08);
  --ok:#2f5d3a; --serif:"Newsreader",Georgia,serif; --display:"Fraunces",Georgia,serif; --mono:"Spline Sans Mono",ui-monospace,monospace;
  --wash:color-mix(in oklab, var(--accent) 7%, var(--bg));
}
@media (prefers-color-scheme:dark){:root{
  --bg:#171310;--surface:#1e1914;--raise:#262019;--ink:#e9e0cd;--muted:#a4937a;--faint:#6e604c;
  --accent:#cf6f5e;--line:rgba(233,224,205,.16);--hair:rgba(233,224,205,.08);--ok:#7fb98f;
  --wash:color-mix(in oklab, var(--accent) 14%, var(--bg));
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--serif);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:920px;margin:0 auto;padding:2.4rem 1.5rem 5rem}
header{display:flex;align-items:baseline;gap:1rem;border-bottom:2px solid var(--ink);padding-bottom:1rem;margin-bottom:1.6rem}
h1{font-family:var(--display);font-variation-settings:"SOFT" 60,"WONK" 1;font-weight:560;font-size:2.1rem;margin:0;letter-spacing:-.01em}
h1 .dock{color:var(--accent)}
header .tag{font-family:var(--mono);font-size:.66rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
header .sp{flex:1}
.tokbtn{font-family:var(--mono);font-size:.72rem;border:1px solid var(--line);background:var(--surface);color:var(--ink);padding:.4rem .8rem;border-radius:99px;cursor:pointer;transition:.18s}
.tokbtn:hover{border-color:var(--accent);color:var(--accent)}
.tokbtn.set{color:var(--ok);border-color:color-mix(in oklab,var(--ok) 40%,transparent)}
.intro{color:var(--muted);font-size:1.02rem;margin:0 0 2rem;max-width:62ch}
.intro code{font-family:var(--mono);font-size:.82em;background:var(--wash);border:1px solid var(--hair);border-radius:4px;padding:.05em .35em}
.proj{background:var(--surface);border:1px solid var(--hair);border-radius:14px;margin:0 0 1.2rem;overflow:hidden;box-shadow:0 14px 40px -28px rgba(40,30,15,.4)}
.proj-head{display:flex;align-items:baseline;gap:.8rem;padding:1rem 1.2rem;border-bottom:1px solid var(--hair)}
.proj-head h2{font-family:var(--display);font-weight:560;font-size:1.3rem;margin:0}
.proj-head a.live{font-family:var(--mono);font-size:.74rem;color:var(--accent);text-decoration:none;border-bottom:1px solid transparent}
.proj-head a.live:hover{border-bottom-color:var(--accent)}
.proj-head .sp{flex:1}
.proj-head .meta{font-family:var(--mono);font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.deploys{list-style:none;margin:0;padding:.4rem 0}
.deploys li{display:grid;grid-template-columns:auto 1fr auto auto;gap:.9rem;align-items:center;padding:.55rem 1.2rem;border-bottom:1px solid var(--hair)}
.deploys li:last-child{border-bottom:0}
.ver{font-family:var(--mono);font-size:.82rem;color:var(--ink)}
.ver a{color:inherit;text-decoration:none;border-bottom:1px dotted var(--faint)}
.ver a:hover{border-bottom-color:var(--accent);color:var(--accent)}
.when{font-family:var(--mono);font-size:.7rem;color:var(--faint)}
.badge{font-family:var(--mono);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--bg);background:var(--ok);border-radius:99px;padding:.15rem .55rem}
.promote{font-family:var(--mono);font-size:.68rem;border:1px solid var(--line);background:var(--raise);color:var(--ink);padding:.3rem .7rem;border-radius:99px;cursor:pointer;transition:.18s}
.promote:hover{border-color:var(--accent);color:var(--accent)}
.empty{color:var(--faint);font-style:italic;padding:3rem 1rem;text-align:center;border:1px dashed var(--line);border-radius:14px}
.empty code{font-family:var(--mono);font-style:normal;font-size:.85em;color:var(--accent)}
footer{margin-top:2.5rem;font-family:var(--mono);font-size:.66rem;color:var(--faint);line-height:1.8;border-top:1px solid var(--hair);padding-top:1rem}
.toast{position:fixed;bottom:1.4rem;left:50%;transform:translateX(-50%) translateY(2rem);background:var(--ink);color:var(--bg);font-family:var(--mono);font-size:.76rem;padding:.6rem 1.1rem;border-radius:99px;opacity:0;transition:.3s;pointer-events:none}
.toast.show{opacity:1;transform:translateX(-50%)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Qua<span class="dock">y</span></h1>
    <span class="tag">self-hosted deploys</span>
    <span class="sp"></span>
    <button class="tokbtn" id="tok">Set token</button>
  </header>
  <p class="intro">Push a build, get an immutable preview URL, promote one to production. Every deploy is a content-addressed version — nothing is overwritten. Deploy from the CLI: <code>quay deploy ./dist --project mysite</code></p>
  <div id="list"></div>
  <footer>
    Quay v0.1 · ${scheme}://${adminHost} · deploys served at <span style="color:var(--accent)">*.${deployHostSuffix}</span><br>
    immutable versions · content-addressed · the reading room's first home
  </footer>
</div>
<div class="toast" id="toast"></div>
<script>
const SCHEME=${JSON.stringify(scheme)}, SUFFIX=${JSON.stringify(deployHostSuffix)}, PORT=${JSON.stringify(portSuffix)};
const toast=(m)=>{const t=document.getElementById("toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2200)};
const tok=()=>localStorage.getItem("quay_token")||"";
function syncTokBtn(){const b=document.getElementById("tok");if(tok()){b.textContent="Token set ✓";b.classList.add("set")}else{b.textContent="Set token";b.classList.remove("set")}}
document.getElementById("tok").onclick=()=>{const v=prompt("Quay API token (printed when the daemon first started):",tok());if(v!==null){localStorage.setItem("quay_token",v.trim());syncTokBtn();toast("Token saved on this device")}};
function previewUrl(project,version){return SCHEME+"://"+version+"--"+project+"."+SUFFIX+PORT}
function prodUrl(project){return SCHEME+"://"+project+"."+SUFFIX+PORT}
function fmtBytes(n){if(n<1024)return n+" B";if(n<1048576)return (n/1024).toFixed(0)+" KB";return (n/1048576).toFixed(1)+" MB"}
async function promote(project,version){
  if(!tok())return toast("Set your token first");
  const r=await fetch("/api/projects/"+project+"/promote",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+tok()},body:JSON.stringify({version})});
  if(r.ok){toast(version+" is now production");load()}else{toast("Promote failed: "+r.status)}
}
async function load(){
  const list=document.getElementById("list");
  let projects=[];
  try{projects=await (await fetch("/api/projects")).json()}catch(e){}
  if(!projects.length){list.innerHTML='<div class="empty">No projects yet. Deploy one:<br><br><code>quay deploy ./your-build --project hello</code></div>';return}
  list.innerHTML=projects.map(p=>{
    const rows=p.deploys.map(d=>{
      const isProd=d.version===p.production;
      return '<li><span class="ver"><a href="'+previewUrl(p.name,d.version)+'" target="_blank">'+d.version+'</a></span>'
        +'<span class="when">'+new Date(d.at).toLocaleString()+' · '+d.files+' files · '+fmtBytes(d.bytes)+'</span>'
        +(isProd?'<span class="badge">production</span>':'<span></span>')
        +(isProd?'<span></span>':'<button class="promote" onclick="promote(\\''+p.name+'\\',\\''+d.version+'\\')">Promote</button>')
        +'</li>';
    }).join("");
    const live=p.production?'<a class="live" href="'+prodUrl(p.name)+'" target="_blank">'+p.name+"."+SUFFIX+' ↗</a>':'<span class="meta">not yet promoted</span>';
    return '<div class="proj"><div class="proj-head"><h2>'+p.name+'</h2>'+live+'<span class="sp"></span><span class="meta">'+p.deploys.length+' deploy'+(p.deploys.length===1?'':'s')+'</span></div><ul class="deploys">'+rows+'</ul></div>';
  }).join("");
}
syncTokBtn();load();
</script>
</body>
</html>`;
}
