import * as data from "@sf/data";
console.log("exports:", Object.keys(data).filter((k) => /MISSION|DIALOG|L10N|RU|EN|campaign/i.test(k)).slice(0, 30).join(","));
console.log("campaign missions:", (data.CAMPAIGN_MISSIONS ?? []).length);
