import * as fs from "fs";
import * as path from "path";
const envPath = path.resolve(process.cwd(), ".env.local");
console.log("envPath:", envPath, "| exists:", fs.existsSync(envPath));
const content = fs.readFileSync(envPath, "utf8");
let matched = 0;
for (const line of content.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) {
    matched++;
    if (m[1] === "SUPABASE_URL" || m[1] === "SUPABASE_SERVICE_ROLE_KEY") {
      console.log(`matched ${m[1]} -> len=${m[2].trim().length}`);
    }
  }
}
console.log("total matched:", matched);
