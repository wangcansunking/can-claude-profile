set -e
echo "=== ENV ==="
. /etc/os-release; echo "OS: $PRETTY_NAME"
echo "node $(node --version), git $(git --version)"
echo ""
echo "=== SEED fresh machine with LOCAL auth (must survive install) ==="
mkdir -p ~/.claude
echo '{ "env": { "ANTHROPIC_API_KEY": "CONTAINER-LOCAL-KEY", "ANTHROPIC_BASE_URL": "http://127.0.0.1:9999" }, "theme": "light", "permissions": {"allow":["Bash(git:*)"]} }' > ~/.claude/settings.json
echo "seeded ~/.claude/settings.json with ANTHROPIC_API_KEY=CONTAINER-LOCAL-KEY"
echo ""
echo "=== RUN one command: ./install.sh --yes ==="
cd /work && chmod +x install.sh
./install.sh --yes 2>&1 | sed 's/\x1b\[[0-9;]*m//g'
echo ""
echo "=== VERIFY ==="
node -e '
const fs=require("fs"),os=require("os"),path=require("path");
const cdir=path.join(os.homedir(),".claude");
const s=JSON.parse(fs.readFileSync(path.join(cdir,"settings.json"),"utf8"));
const skills=fs.readdirSync(path.join(cdir,"skills"));
let pass=0,fail=0; const chk=(n,c)=>{console.log((c?"PASS":"FAIL")+" "+n); c?pass++:fail++;};
chk("20 skills installed ("+skills.length+")", skills.length===20);
chk("caveman present (lost upstream, survived via vendor)", skills.includes("caveman"));
chk("write-a-skill present", skills.includes("write-a-skill"));
chk("zoom-out present", skills.includes("zoom-out"));
chk("local ANTHROPIC_API_KEY preserved", s.env.ANTHROPIC_API_KEY==="CONTAINER-LOCAL-KEY");
chk("local ANTHROPIC_BASE_URL preserved", s.env.ANTHROPIC_BASE_URL==="http://127.0.0.1:9999");
chk("repo AGENT_TEAMS flag applied", s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS==="1");
chk("repo model applied", !!s.env.ANTHROPIC_MODEL);
chk("user permissions untouched", JSON.stringify(s.permissions)===JSON.stringify({allow:["Bash(git:*)"]}));
chk("16 plugins enabled", Object.keys(s.enabledPlugins||{}).length===16);
chk("no Microsoft skill (ado-*)", !skills.some(x=>x.startsWith("ado-")));
chk("no validate-build skill", !skills.includes("validate-build"));
chk("backup created", fs.existsSync(path.join(cdir,"backups","profile-install")));
console.log("\n=== "+pass+" passed, "+fail+" failed ===");
process.exit(fail?1:0);
'
