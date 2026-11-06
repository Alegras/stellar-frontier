import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
const html = readFileSync("apps/web/dist/index.html", "utf8");
const jsUrl = html.slice(html.indexOf('src="') + 5).split('"')[0];
const cssUrl = html.slice(html.indexOf('rel="stylesheet"')).split('href="')[1].split('"')[0];
const jsPath = jsUrl.replace(/^\//, "");
const cssPath = cssUrl.replace(/^\//, "");
let js = readFileSync("apps/web/dist/" + jsPath, "utf8");
let css = readFileSync("apps/web/dist/" + cssPath, "utf8");

// DLC XIV: ассеты /dlc/** в single-file сборке встраиваем как data URI (file:// не имеет корня /dlc).
const PUBLIC = "apps/web/public";
const embedded = new Map();
const embedDlc = (text) => text.replace(/\/dlc\/[A-Za-z0-9_\/.\-]+\.png/g, (url) => {
  if (embedded.has(url)) return embedded.get(url);
  const file = PUBLIC + url;
  if (!existsSync(file)) return url;
  const b64 = readFileSync(file).toString("base64");
  const dataUri = "data:image/png;base64," + b64;
  embedded.set(url, dataUri);
  return dataUri;
});
js = embedDlc(js);
css = embedDlc(css);
if (embedded.size > 0) console.log("embedded DLC assets:", embedded.size);
if (js.includes("</script")) throw new Error("bundle contains </script, needs escaping");
const scriptStart = html.indexOf('<script type="module"');
const scriptEnd = html.indexOf("</script>", scriptStart) + "</script>".length;
const linkStart = html.indexOf('<link rel="stylesheet"');
const linkEnd = html.indexOf(">", linkStart) + 1;
let out = html.slice(0, scriptStart) + html.slice(scriptEnd);
const linkStart2 = out.indexOf('<link rel="stylesheet"');
const linkEnd2 = out.indexOf(">", linkStart2) + 1;
out = out.slice(0, linkStart2) + out.slice(linkEnd2);
out = out.replace("</head>", () => "  <style>\n" + css + "\n  </style>\n</head>");
out = out.replace("</body>", () => "  <script type=\"module\">\n" + js + "\n  </script>\n</body>");
// Все PNG из public/dlc встраиваем в карту и добавляем file://-шим для динамических путей
// (портрет диалога, комикс, фон карточки): src/backgroundImage "/dlc/..." -> data URI.
const dlcRoot = path.join(PUBLIC, "dlc");
const dlcMap = {};
const walkDlc = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walkDlc(full); continue; }
    if (!entry.name.endsWith(".png")) continue;
    const rel = "/" + path.relative(PUBLIC, full).split(path.sep).join("/");
    dlcMap[rel] = "data:image/png;base64," + readFileSync(full).toString("base64");
  }
};
if (existsSync(dlcRoot)) walkDlc(dlcRoot);
const shimCode = readFileSync("tools/portable-shim.js", "utf8");
const inject = "<script>window.__SF_DLC_ASSETS__=" + JSON.stringify(dlcMap) + ";</script>\n<script>\n" + shimCode + "\n</script>";
out = out.replace("<head>", () => "<head>\n" + inject);
writeFileSync("StellarFrontier.html", out);
console.log("written", out.length, "bytes", jsPath, cssPath);