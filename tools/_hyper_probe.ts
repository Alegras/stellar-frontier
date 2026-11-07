import { BALANCE, MODE } from "@sf/data";
import { createWorld, applyCommand } from "../packages/sim/src/index.ts";
const w=createWorld(42,MODE,BALANCE); const pid=w.playerEmpireId;
const f=w.fleets.find(x=>x.empireId===pid && x.ships.length>0); if(!f) throw new Error("no fleet");
f.ships.push({...f.ships[0], id: 900001, designId: "pathfinder_ark"});
const from=w.systems[f.systemId]; let target=null;
for(const s of w.systems){ if(s.id===from.id||from.links.includes(s.id)) continue; const d=Math.hypot(from.x-s.x,from.y-s.y); if(d<1100){target=s;break;} }
if(!target) throw new Error("no target");
const r=applyCommand(w,{type:"plot_hyperlane",fleetId:f.id,targetSystemId:target.id});
console.log(JSON.stringify({ok:r.ok,msg:r.messageRu,linked:from.links.includes(target.id),back:target.links.includes(from.id)}));
