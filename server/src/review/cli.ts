import { loadServerEnv } from "../env.js";
loadServerEnv();

const { listReviewable, approveSkill, rejectSkill, formatSkillLine } = await import("./actions.js");
const { getSkill } = await import("../skills/repo.js");
const { pool } = await import("../db/pool.js");

const [cmd = "list", id] = process.argv.slice(2);

function requireId(): string {
  if (!id) {
    console.error(`usage: npm run review -- ${cmd} <skill-id>`);
    process.exit(1);
  }
  return id;
}

switch (cmd) {
  case "list": {
    const skills = await listReviewable();
    if (skills.length === 0) console.log("Review queue is empty. Nothing parked.");
    for (const s of skills) console.log(formatSkillLine(s));
    break;
  }
  case "show": {
    const s = await getSkill(requireId());
    if (!s) { console.error("skill not found"); process.exit(1); }
    console.log(JSON.stringify(s, null, 2));
    break;
  }
  case "approve": {
    const s = await approveSkill(requireId());
    console.log(`approved -> ${formatSkillLine(s)}`);
    break;
  }
  case "reject": {
    const s = await rejectSkill(requireId());
    console.log(`rejected -> ${formatSkillLine(s)}`);
    break;
  }
  default:
    console.error("usage: npm run review -- [list | show <id> | approve <id> | reject <id>]");
    process.exit(1);
}

await pool.end();
