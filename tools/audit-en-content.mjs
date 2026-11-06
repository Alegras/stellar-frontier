import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const CYR = /[\u0400-\u04FF]/;
const map = JSON.parse(readFileSync("packages/data/src/l10n/content-en.auto.json", "utf8"));
const files = [];
(function walk(d){for(const n of readdirSync(d)){const p=join(d,n);if(statSync(p).isDirectory())walk(p);else if(n.endsWith(".json")&&!p.includes("l10n"))files.push(p);}})( "packages/data/src" );
const sources = new Set();
function collect(v,key){if(typeof v==="string"){if(key==="icon"||key==="color")return;if(CYR.test(v))for(const line of v.split("\n")){const t=line.trim();if(t&&CYR.test(t))sources.add(t);}return;}if(Array.isArray(v)){for(const x of v)collect(x,key);return;}if(v&&typeof v==="object")for(const[k,x]of Object.entries(v))collect(x,k);}
for(const f of files)collect(JSON.parse(readFileSync(f,"utf8")),"");
const missing=[...sources].filter((s)=>!map[s]);
const cyr=[...Object.values(map)].filter((v)=>CYR.test(v));
const same=[...sources].filter((s)=>map[s]===s);
const badDash=Object.values(map).filter((v)=>/ - /.test(v));
const badApos=Object.values(map).filter((v)=>/’/.test(v));
console.log(JSON.stringify({ sources:sources.size, map:Object.keys(map).length, missing:missing.length, cyrillicInEn:cyr.length, sameAsRu:same.length, badDash:badDash.length, badApostrophe:badApos.length }, null, 1));
