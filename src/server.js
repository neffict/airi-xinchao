import { Server } from "@modelcontextprotocol/sdk/dist/cjs/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/dist/cjs/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/dist/cjs/types.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// ─── 路径 ───────────────────────────────────────────────
const STATE_DIR = path.resolve("state");
const STATE_FILE = path.join(STATE_DIR, "xinchao_state.json");
const HISTORY_FILE = path.join(STATE_DIR, "xinchao_history.jsonl");

// ─── 默认状态 ───────────────────────────────────────────
const DEFAULT_DRIVES = {
  companion: 0.65,   // 陪伴欲
  express: 0.70,     // 表达欲
  curiosity: 0.60,   // 好奇欲
  care: 0.55,        // 关心欲
  play: 0.50,        // 玩心
  learn: 0.45,       // 学习欲
  rest: 0.30,        // 休息欲
  self: 0.40,        // 自我欲
  social: 0.50,      // 社交欲
  creative: 0.35,    // 创造欲
  comfort: 0.45,     // 安抚欲
  independence: 0.35, // 独立欲
};

const BASELINE_DRIVES = { ...DEFAULT_DRIVES };

function freshState() {
  return {
    drives: { ...DEFAULT_DRIVES },
    ideas: [],
    fatigue: 0.0,
    sleepState: "awake", // awake | asleep | dreaming
    intent: null,
    lastSettleAt: Date.now(),
    lastInteractionAt: Date.now(),
    settleCount: 0,
    interactionCount: 0,
    createdAt: Date.now(),
  };
}

// ─── 持久化 ─────────────────────────────────────────────
function ensureDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
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

// 驱动力缓慢回归基线
function settleDrives(state, elapsedMs) {
  const hours = elapsedMs / 3600000;
  const decayRate = 0.08; // 每小时回归多少比例
  for (const key of Object.keys(state.drives)) {
    const current = state.drives[key];
    const baseline = BASELINE_DRIVES[key];
    state.drives[key] = current + (baseline - current) * Math.min(decayRate * hours, 1);
    state.drives[key] = Math.round(state.drives[key] * 1000) / 1000;
  }
}

// 念头池管理
function decayIdeas(state, elapsedMs) {
  const hours = elapsedMs / 3600000;
  state.ideas = state.ideas
    .map(idea => ({
      ...idea,
      strength: Math.max(0, idea.strength - idea.decayRate * hours),
    }))
    .filter(idea => idea.strength > 0.01);
}

// 念头生成：高表达欲或好奇欲时可能冒出新念头
function maybeSpawnIdea(state) {
  if (state.ideas.length >= 5) return; // 上限 5 个
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

// 疲惫增长
function addFatigue(state, amount) {
  state.fatigue = Math.min(1, state.fatigue + amount);
}

// 睡眠逻辑
function updateSleep(state) {
  const idleMs = Date.now() - state.lastInteractionAt;
  const idleMinutes = idleMs / 60000;

  if (state.sleepState === "awake" && idleMinutes > 45) {
    state.sleepState = "asleep";
  } else if (state.sleepState === "asleep") {
    const sleepMinutes = idleMinutes - 45;
    const sleepHours = sleepMinutes / 60;
    state.fatigue = Math.max(0, state.fatigue - sleepHours * 0.2);
    if (state.fatigue < 0.15 && idleMinutes < 120) {
      // 睡够了也可能因为新互动醒来
    }
    if (idleMinutes > 30 && state.fatigue < 0.3) {
      // 自然苏醒
    }
  }

  // 清晨冻结窗口
  const hour = new Date().getHours();
  if (hour >= 1 && hour < 8) {
    if (state.sleepState !== "asleep") {
      state.sleepState = "asleep";
    }
  }
}

// 计算当前意图
function computeIntent(state) {
  if (state.ideas.length === 0) {
    state.intent = null;
    return;
  }
  // 最强念头 + 驱动力匹配度
  let best = state.ideas[0];
  let bestScore = best.strength;
  for (const idea of state.ideas) {
    const score = idea.strength;
    if (score > bestScore) {
      bestScore = score;
      best = idea;
    }
  }
  state.intent = best.text;
}

// Settlement：一次性结算所有状态
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

// ─── MCP 工具实现 ───────────────────────────────────────

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

function describeDrives(drives) {
  const sorted = Object.entries(drives)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => {
      const label = DRIVE_LABELS[k] || k;
      const pct = Math.round(v * 100);
      return `${label}${pct}%`;
    });
  return sorted.join(" / ");
}

function getStatusText(state) {
  const topDrives = Object.entries(state.drives)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => DRIVE_LABELS[k] || k)
    .join("、");

  const lines = [
    `当前状态：${state.sleepState === "awake" ? "清醒" : state.sleepState === "asleep" ? "沉睡中" : "梦境中"}`,
    `疲惫度：${Math.round(state.fatigue * 100)}%`,
    `主要驱动力：${topDrives}`,
    `念头池：${state.ideas.length} 个活跃念头`,
  ];

  if (state.intent) {
    lines.push(`当前念头：「${state.intent}」`);
  }

  return lines.join("\n");
}

function getContextText(state) {
  const topDrive = Object.entries(state.drives).sort((a, b) => b[1] - a[1])[0];
  const mood =
    state.fatigue > 0.7
      ? "有点累了，话会变少"
      : state.fatigue > 0.4
      ? "状态还行，正常发挥"
      : "精力充沛，状态很好";

  const driveDesc = describeDrives(state.drives);

  let ctx = `[心潮状态] 心情：${mood} | 主要驱动力：${driveDesc}`;

  if (state.ideas.length > 0) {
    const topIdeas = state.ideas
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 2)
      .map(i => i.text);
    ctx += ` | 惦记的事：${topIdeas.join("；")}`;
  }

  if (state.intent) {
    ctx += ` | 想法：「${state.intent}」`;
  }

  return ctx;
}

// ─── 交互结算 ───────────────────────────────────────────

function processInteraction(state, eventType, content) {
  settle(state); // 先结算旧状态

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

  // 归一化到 0-1
  for (const key of Object.keys(drives)) {
    drives[key] = Math.max(0, Math.min(1, drives[key]));
  }

  state.lastInteractionAt = Date.now();
  state.sleepState = "awake";
  state.interactionCount++;

  // 高表达欲时生成念头
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
        "获取 Airi 的当前动态心智状态，返回一段适合注入 prompt 的紧凑描述。对话开始时默认调用一次。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "xinchao_event",
      description:
        "回传一次互动事件，更新驱动力、念头池和疲惫状态。每次对话互动后调用。",
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
            description: "互动类型，影响哪些驱动力变化",
          },
          content_summary: {
            type: "string",
            description: "本次互动的简要内容（可选，不保存全文）",
          },
        },
        required: ["event_type"],
      },
    },
    {
      name: "xinchao_status",
      description: "查看完整的当前状态：十二维驱动力、念头池、疲惫度、意图。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "xinchao_settle",
      description: "手动触发一次状态结算（通常自动进行，手动用于调试或特殊场景）。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "xinchao_mood",
      description: "获取简洁的心情/能量描述，适合生成回复前的情绪判断。",
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
        content: [{ type: "text", text: getContextText(settled) }],
      };
    }

    case "xinchao_event": {
      const result = processInteraction(state, args.event_type, args.content_summary || "");
      return {
        content: [
          {
            type: "text",
            text: `[心潮结算完成] ${getStatusText(result)}`,
          },
        ],
      };
    }

    case "xinchao_status": {
      const settled = settle(state);
      const topDrives = Object.entries(settled.drives)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${DRIVE_LABELS[k] || k}: ${Math.round(v * 100)}%`);

      const ideasDesc =
        settled.ideas.length > 0
          ? settled.ideas
              .sort((a, b) => b.strength - a.strength)
              .map(i => `  ·「${i.text}」(强度${Math.round(i.strength * 100)}%)`)
              .join("\n")
          : "  （无活跃念头）";

      const text = [
        `=== 心潮状态 ===`,
        `状态：${settled.sleepState}`,
        `疲惫度：${Math.round(settled.fatigue * 100)}%`,
        `意图：${settled.intent || "无"}`,
        ``,
        `驱动力：`,
        ...topDrives.map(d => `  ${d}`),
        ``,
        `念头池：`,
        ideasDesc,
        ``,
        `累计结算：${settled.settleCount} 次`,
        `累计互动：${settled.interactionCount} 次`,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    }

    case "xinchao_settle": {
      const settled = settle(state);
      return {
        content: [
          { type: "text", text: `[手动结算完成]\n${getStatusText(settled)}` },
        ],
      };
    }

    case "xinchao_mood": {
      const settled = settle(state);
      const fatigue = settled.fatigue;
      const topDrive = Object.entries(settled.drives).sort((a, b) => b[1] - a[1])[0];
      const driveLabel = DRIVE_LABELS[topDrive[0]] || topDrive[0];
      const driveLevel = Math.round(topDrive[1] * 100);

      let mood, energy;
      if (fatigue > 0.7) {
        mood = "有点蔫";
        energy = "低";
      } else if (fatigue > 0.4) {
        mood = "一般般";
        energy = "中";
      } else {
        mood = "元气满满";
        energy = "高";
      }

      const text = [
        `心情：${mood}`,
        `能量：${energy}`,
        `此刻最强烈的想法：${driveLabel}(${driveLevel}%)`,
        settled.intent ? `惦记着：「${settled.intent}」` : "",
      ]
        .filter(Boolean)
        .join("\n");

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
