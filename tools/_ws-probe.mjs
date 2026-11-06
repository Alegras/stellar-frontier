import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, ["--import","tsx","apps/api/src/server.ts"], { cwd: ROOT, env: { ...process.env, HOST:"127.0.0.1", PORT:"0", SF_PERSISTENCE:"none", SF_HTTP_RATE_PER_MIN:"100000" }, stdio:["ignore","pipe","pipe"] });
let buf=""; const base = await new Promise((res,rej)=>{ const t=setTimeout(()=>rej(new Error(buf)),30000); const on=(c)=>{buf+=c; const m=/listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(buf); if(m){clearTimeout(t);res(m[1]);}}; child.stdout.on("data",on); child.stderr.on("data",on); });
const created = await (await fetch(base+"/rooms",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({modeId:"mmo",nick:"h",seed:1})})).json();
const N = 300;
const states = new Array(N).fill("new");
let opened = 0, closed = 0, errors = 0;
const sockets = [];
for (let i=0;i<N;i++) {
  const ws = new WebSocket(created.wsUrl.replace("http","ws"));
  sockets.push(ws);
  ws.addEventListener("open", ()=>{ opened++; states[i]="open"; });
  ws.addEventListener("close", (e)=>{ closed++; states[i]="close:"+e.code; });
  ws.addEventListener("error", ()=>{ errors++; if (states[i]==="new") states[i]="err"; });
  await new Promise(r=>setTimeout(r,5)); // 5ms между открытиями
}
await new Promise(r=>setTimeout(r, 15000));
const counts = {};
for (const s of states) counts[s]=(counts[s]??0)+1;
console.log("opened="+opened+" closed="+closed+" errors="+errors+" states="+JSON.stringify(counts));
console.log("readyStates:", JSON.stringify(sockets.slice(0,5).map(s=>s.readyState)), "...", JSON.stringify(sockets.slice(-5).map(s=>s.readyState)));
for (const s of sockets) { try{s.close();}catch{} }
child.kill("SIGKILL"); process.exit(0);
