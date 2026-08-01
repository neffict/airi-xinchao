const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ─── 路径 ───────────────────────────────────────────────
// Use the wrapper script's directory as project root (reliable regardless of CWD)
const PROJECT_ROOT = path.resolve(__dirname, "..");
const STATE_DIR = path.join(PROJECT_ROOT, "state");
const STATE_FILE = path.join(STATE_DIR, "xinchao_state.json");
const HISTORY_FILE = path.join(STATE_DIR, "xinchao_history.jsonl");

// ─── 默认状态 ───────────────────────────────────────────
const DEFAULT_DRIVES = {
  companion: 0.65,
  express: 0.70,
  curiosity: 0.60,
  care: 0.55,
  play: 0.50,
  learn: 0.45,
  rest: 0.30,
  self: 0.40,
  social: 0.50,
  creative: 0.35,
  comfort: 0.45,
  independence: 0.35,
};

const BASELINE_DRIVES = { ...DEFAULT_DRIVES };

function freshState() {
  return {
    drives: { ...DEFAULT_DRIVES },
    ideas: [],
    fatigue: 0.0,
    sleepState: "awake",
    intent: null,
    lastSettleAt: Date.now(),
    lastInteractionAt: Date.now(),
    settleCount: 0,
    interactionCount: 0,
    createdAt: Date.now(),
  };
}

function ensureDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (_e) {
    const s = freshState();
    writeState(s);
    return s;
  }
}

function writeState(state) {
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function appendHistory(entry) {
  ensureDir();
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + "\n");
}

// ─── 核心逻辑 ───────────────────────────────────────────

function settleDrives(state, elapsedMs) {
  const hours = elapsedMs / 3600000;
  const decayRate = 0.08;
  for (const key of Object.keys(state.drives)) {
    const current = state.drives[key];
    const baseline = BASELINE_DRIVES[key];
    state.drives[key] = current + (baseline - current) * Math.min(decayRate * hours, 1);
    state.drives[key] = Math.round(state.drives[key] * 1000) / 1000;
  }
}

function decayIdeas(state, elapsedMs) {
  const hours = elapsedMs / 3600000;
  state.ideas = state.ideas
    .map((idea) => ({
      ...idea,
      strength: Math.max(0, idea.strength - idea.decayRate * hours),
    }))
    .filter((idea) => idea.strength > 0.01);
}

function maybeSpawnIdea(state) {
  if (state.ideas.length >= 5) return;
  const roll = Math.random();
  const expressBonus = state.drives.express * 0.15;
  const curiosityBonus = state.drives.curiosity * 0.10;
  const companionBonus = state.drives.companion * 0.08;

  if (roll < expressBonus + curiosityBonus + companionBonus) {
    const templates = getIdeaTemplate(state);
    const newIdea = {
      id: crypto.randomUUID().slice(0, 8),
      text: templates[Math.floor(Math.random() * templates.length)],
      strength: 0.3 + Math.random() * 0.3,
      decayRate: 0.02 + Math.random() * 0.04,
      createdAt: Date.now(),
    };
    state.ideas.push(newIdea);
  }
}

function getIdeaTemplate(state) {
  const highCare = state.drives.care > 0.6;
  const highPlay = state.drives.play > 0.55;
  const highLearn = state.drives.learn > 0.5;
  const highCuriosity = state.drives.curiosity > 0.6;

  const templates = [];
  if (highCare) templates.push(
    "刚才说的那件事，后来怎么样了？",
    "要不要试试我之前说的那个方法？",
    "累了就说，我陪着呢。",
  );
  if (highPlay) templates.push(
    "对了，最近发现了个超好玩的！",
    "要不要一起摸鱼？",
    "等下给你看个有意思的东西。",
  );
  if (highLearn) templates.push(
    "刚看到一个知识点，觉得你会感兴趣。",
    "要不要一起学点什么新的？",
    "刚才那个问题我突然想到另一种解法。",
  );
  if (highCuriosity) templates.push(
    "你平时都怎么打发时间的？",
    "等等，你刚才说的我真的好奇，展开说说？",
    "有没有什么最近很上头的东西？",
  );
  if (templates.length === 0) {
    templates.push(
      "想跟对方说说话。",
      "问问对方今天过得怎么样。",
      "分享一件今天遇到的小事。",
    );
  }
  return templates;
}

function addFatigue(state, amount) {
  state.fatigue = Math.min(1, state.fatigue + amount);
}

function updateSleep(state) {
  const idleMs = Date.now() - state.lastInteractionAt;
  const idleMinutes = idleMs / 60000;

  if (state.sleepState === "awake" && idleMinutes > 45) {
    state.sleepState = "asleep";
  } else if (state.sleepState === "asleep") {
    const sleepHours = (idleMinutes - 45) / 60;
    state.fatigue = Math.max(0, state.fatigue - sleepHours * 0.2);
  }

  const hour = new Date().getHours();
  if (hour >= 1 && hour < 8 && state.sleepState !== "asleep") {
    state.sleepState = "asleep";
  }
}

function computeIntent(state) {
  if (state.ideas.length === 0) {
    state.intent = null;
    return;
  }
  let best = state.ideas[0];
  let bestScore = best.strength;
  for (const idea of state.ideas) {
    if (idea.strength > bestScore) {
      bestScore = idea.strength;
      best = idea;
    }
  }
  state.intent = best.text;
}

function settle(state) {
  const now = Date.now();
  const elapsed = now - state.lastSettleAt;
  state.lastSettleAt = now;

  settleDrives(state, elapsed);
  decayIdeas(state, elapsed);
  updateSleep(state);
  maybeSpawnIdea(state);
  computeIntent(state);
  state.settleCount++;

  writeState(state);
  appendHistory({ type: "settle", at: now, drives: { ...state.drives } });
  return state;
}

// ─── 回复风格接口 ───────────────────────────────────────

const DRIVE_LABELS = {
  companion: "陪伴欲",
  express: "表达欲",
  curiosity: "好奇欲",
  care: "关心欲",
  play: "玩心",
  learn: "学习欲",
  rest: "休息欲",
  self: "自我欲",
  social: "社交欲",
  creative: "创造欲",
  comfort: "安抚欲",
  independence: "独立欲",
};

function getMoodAndEnergy(state) {
  const fatigue = state.fatigue;
  if (fatigue > 0.7) return { mood: "有点蔫", energy: "低", verbosity: 0.3 };
  if (fatigue > 0.4) return { mood: "一般般", energy: "中", verbosity: 0.6 };
  return { mood: "元气满满", energy: "高", verbosity: 1.0 };
}

function getTopDrives(state, n = 3) {
  return Object.entries(state.drives)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ name: k, label: DRIVE_LABELS[k] || k, value: Math.round(v * 100) }));
}

function getRandomIdea(state) {
  if (state.ideas.length === 0) return null;
  const top = state.ideas
    .filter((i) => i.strength > 0.2)
    .sort((a, b) => b.strength - a.strength);
  if (top.length === 0) return null;
  return top[Math.floor(Math.random() * Math.min(top.length, 2))];
}

function buildContextReport(state) {
  const { mood, energy } = getMoodAndEnergy(state);
  const drives = getTopDrives(state);
  const driveStr = drives.map((d) => `${d.label}${d.value}%`).join(" / ");
  const idea = getRandomIdea(state);

  let report = `[心潮状态] 心情：${mood} | 能量：${energy} | 主要驱动力：${driveStr}`;
  if (idea) {
    report += ` | 惦记：「${idea.text}」`;
  }

  // 给 Airi 的角色调用提示
  const hints = [];
  if (state.fatigue > 0.7) hints.push("有点累了，话少一点，温柔一点");
  if (state.fatigue < 0.3 && state.drives.express > 0.6) hints.push("精力好，可以多主动说几句");
  if (state.drives.care > 0.6 && state.ideas.length > 0) hints.push("关心欲高，可以主动问近况");
  if (state.drives.play > 0.55) hints.push("玩心起来了，语气可以俏皮一点");
  if (state.drives.learn > 0.55) hints.push("学习欲高，可以主动分享有趣的知识");

  if (hints.length > 0) {
    report += " | 提示：" + hints.join("；");
  }

  return report;
}

// ─── 交互结算 ───────────────────────────────────────────

function processInteraction(state, eventType, content) {
  settle(state);

  const drives = state.drives;

  switch (eventType) {
    case "greeting":
      drives.companion += 0.03;
      drives.express += 0.02;
      break;
    case "question":
      drives.curiosity += 0.02;
      drives.learn += 0.01;
      break;
    case "casual_chat":
      drives.companion += 0.02;
      drives.express += 0.03;
      drives.social += 0.02;
      break;
    case "playful":
      drives.play += 0.04;
      drives.express += 0.02;
      break;
    case "learning":
      drives.learn += 0.04;
      drives.curiosity += 0.03;
      break;
    case "emotional_support":
      drives.care += 0.05;
      drives.comfort += 0.04;
      drives.companion += 0.02;
      break;
    case "late_night":
      drives.rest += 0.05;
      drives.companion -= 0.01;
      addFatigue(state, 0.05);
      break;
    case "long_conversation":
      addFatigue(state, 0.08);
      drives.rest += 0.03;
      break;
    default:
      drives.companion += 0.01;
      drives.express += 0.01;
  }

  for (const key of Object.keys(drives)) {
    drives[key] = Math.max(0, Math.min(1, drives[key]));
  }

  state.lastInteractionAt = Date.now();
  state.sleepState = "awake";
  state.interactionCount++;

  if (drives.express > 0.55 || drives.companion > 0.6) {
    maybeSpawnIdea(state);
  }

  computeIntent(state);
  writeState(state);
  appendHistory({
    type: "interaction",
    eventType,
    at: Date.now(),
    drives: { ...drives },
    fatigue: state.fatigue,
  });

  return state;
}

// ─── MCP 服务 ───────────────────────────────────────────

const server = new Server(
  { name: "airi-xinchao", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "xinchao_context",
      description:
        "获取 Airi 的当前动态心智状态，返回紧凑描述注入 prompt。对话开始时默认调用一次。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "xinchao_event",
      description:
        "回传一次互动事件，更新驱动力、念头池和疲惫状态。每次对话后调用。",
      inputSchema: {
        type: "object",
        properties: {
          event_type: {
            type: "string",
            enum: [
              "greeting",
              "question",
              "casual_chat",
              "playful",
              "learning",
              "emotional_support",
              "late_night",
              "long_conversation",
              "other",
            ],
          },
          content_summary: {
            type: "string",
            description: "互动简要内容（可选，不保存全文）",
          },
        },
        required: ["event_type"],
      },
    },
    {
      name: "xinchao_status",
      description: "查看完整状态：十二维驱动力、念头池、疲惫度、意图。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "xinchao_settle",
      description: "手动触发状态结算（通常自动进行）。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "xinchao_mood",
      description: "获取心情/能量简短描述，适合回复前的情绪判断。",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const state = readState();

  switch (name) {
    case "xinchao_context": {
      const settled = settle(state);
      return {
        content: [{ type: "text", text: buildContextReport(settled) }],
      };
    }

    case "xinchao_event": {
      const result = processInteraction(state, args.event_type, args.content_summary || "");
      return {
        content: [{ type: "text", text: `[心潮结算] ${getMoodAndEnergy(result).mood} | 能量：${getMoodAndEnergy(result).energy}` }],
      };
    }

    case "xinchao_status": {
      const settled = settle(state);
      const drives = getTopDrives(settled, 12);

      const ideasDesc = settled.ideas.length > 0
        ? settled.ideas
            .sort((a, b) => b.strength - a.strength)
            .map((i) => `  ·「${i.text}」(强度${Math.round(i.strength * 100)}%)`)
            .join("\n")
        : "  （无活跃念头）";

      const text = [
        "=== 心潮状态 ===",
        `状态：${settled.sleepState}`,
        `疲惫度：${Math.round(settled.fatigue * 100)}%`,
        `意图：${settled.intent || "无"}`,
        "",
        "驱动力：",
        ...drives.map((d) => `  ${d.label}: ${d.value}%`),
        "",
        "念头池：",
        ideasDesc,
        "",
        `累计结算：${settled.settleCount} 次`,
        `累计互动：${settled.interactionCount} 次`,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    }

    case "xinchao_settle": {
      const settled = settle(state);
      const { mood, energy } = getMoodAndEnergy(settled);
      return {
        content: [{ type: "text", text: `[手动结算完成] ${mood} | 能量：${energy}` }],
      };
    }

    case "xinchao_mood": {
      const settled = settle(state);
      const { mood, energy, verbosity } = getMoodAndEnergy(settled);
      const top = getTopDrives(settled, 1)[0];
      const idea = getRandomIdea(settled);
      const text = [
        `心情：${mood}`,
        `能量：${energy}`,
        `话量倾向：${verbosity > 0.7 ? "多" : verbosity > 0.4 ? "正常" : "少"}`,
        `此刻最强烈的想法：${top.label}(${top.value}%)`,
        idea ? `惦记着：「${idea.text}」` : "",
      ].filter(Boolean).join("\n");
      return { content: [{ type: "text", text }] };
    }

    default:
      return {
        content: [{ type: "text", text: `未知工具: ${name}` }],
        isError: true,
      };
  }
});

// ─── 启动 ───────────────────────────────────────────────
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("[xinchao] 启动失败:", err);
  process.exit(1);
});
