const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const AGNES_BASE_URL = "https://apihub.agnes-ai.com/v1";
const API_KEY = process.env.AGNES_API_KEY || "";

const AGNES_VIDEO_MODEL = "agnes-video-v2.0";

const VALID_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
const VALID_RESOLUTIONS = ["480p", "720p", "1080p"];
const DEFAULT_ASPECT_RATIO = "16:9";
const DEFAULT_RESOLUTION = "720p";
const DEFAULT_DURATION = 5;
const POLL_INTERVAL = 5000;
const MAX_WAIT = 300000;

const CACHE_DIR = path.join(process.env.HOME, ".agnes-cache", "videos");

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "apihub.agnes-ai.com",
      path: urlPath,
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
    };
    if (body) options.headers["Content-Length"] = Buffer.byteLength(JSON.stringify(body));

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks)));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function downloadToFile(url) {
  return new Promise((resolve, reject) => {
    ensureCacheDir();
    const filename = `agnes_video_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.mp4`;
    const filepath = path.join(CACHE_DIR, filename);
    const file = fs.createWriteStream(filepath);

    const doGet = (targetUrl) => {
      https.get(targetUrl, { headers: { Authorization: `Bearer ${API_KEY}` } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(filepath); });
      }).on("error", (err) => {
        fs.unlink(filepath, () => {});
        reject(err);
      });
    };
    doGet(url);
  });
}

// ─── MCP Server ─────────────────────────────────────────

const server = new Server(
  { name: "agnes-video", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "agnes_generate_video",
      description: "使用 Agnes AI 生成视频。输入文字描述，返回生成的视频文件路径。",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "视频描述（中文/英文均可）" },
          model: {
            type: "string",
            enum: ["agnes-video-v2.0"],
            description: "使用的模型",
          },
          aspect_ratio: {
            type: "string",
            enum: VALID_ASPECT_RATIOS,
            description: "画面比例",
          },
          resolution: {
            type: "string",
            enum: VALID_RESOLUTIONS,
            description: "分辨率",
          },
          duration: {
            type: "integer",
            minimum: 3,
            maximum: 10,
            description: "视频时长（秒）",
          },
          image_url: {
            type: "string",
            description: "可选的参考图片 URL 或本地路径（图生视频）",
          },
          audio: {
            type: "boolean",
            description: "是否生成配乐",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "agnes_video_status",
      description: "查询视频生成任务的状态（任务 ID）。",
      inputSchema: {
        type: "object",
        properties: {
          request_id: { type: "string", description: "生成任务 ID" },
        },
        required: ["request_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (!API_KEY) {
    return {
      content: [{ type: "text", text: "错误：未设置 AGNES_API_KEY 环境变量" }],
      isError: true,
    };
  }

  switch (name) {
    case "agnes_generate_video": {
      try {
        const aspect = args.aspect_ratio || DEFAULT_ASPECT_RATIO;
        const resolution = args.resolution || DEFAULT_RESOLUTION;
        const duration = args.duration || DEFAULT_DURATION;
        const clampedDuration = Math.max(3, Math.min(10, duration));

        ensureCacheDir();

        const payload = {
          model: args.model || AGNES_VIDEO_MODEL,
          prompt: args.prompt,
          aspect_ratio: aspect,
          resolution,
          duration: clampedDuration,
        };

        if (args.audio !== undefined) payload.audio = args.audio;

        if (args.image_url) {
          const ref = String(args.image_url).trim();
          if (ref.startsWith("http")) {
            payload.image = { url: ref };
          } else {
            const mime = "image/png";
            const b64 = fs.readFileSync(ref, "base64");
            payload.image = { url: `data:${mime};base64,${b64}` };
          }
        }

        // Submit
        const submitResult = await apiRequest("POST", "/v1/videos/generations", payload);
        const requestId = submitResult.id || submitResult.request_id;
        if (!requestId) {
          return {
            content: [{ type: "text", text: `Agnes 未返回任务 ID：${JSON.stringify(submitResult).slice(0, 200)}` }],
            isError: true,
          };
        }

        // Poll
        const startTime = Date.now();
        let lastStatus = "queued";
        while (Date.now() - startTime < MAX_WAIT) {
          await sleep(POLL_INTERVAL);
          const statusResult = await apiRequest("GET", `/v1/videos/generations/${requestId}`);
          lastStatus = (statusResult.status || "").toLowerCase();

          if (lastStatus === "completed") {
            const videoData = statusResult.video || statusResult.data || {};
            const videoUrl = typeof videoData === "string" ? videoData : videoData.url;

            if (!videoUrl) {
              return {
                content: [{ type: "text", text: "视频生成完成但未返回 URL" }],
                isError: true,
              };
            }

            const filepath = await downloadToFile(videoUrl);
            return {
              content: [
                {
                  type: "text",
                  text: `视频已生成并保存到：${filepath}\n模型：${payload.model}\n时长：${clampedDuration}s\n比例：${aspect}\n分辨率：${resolution}`,
                },
              ],
            };
          }

          if (["failed", "error", "expired", "cancelled"].includes(lastStatus)) {
            return {
              content: [{ type: "text", text: `视频生成失败，状态：${lastStatus}` }],
              isError: true,
            };
          }
        }

        return {
          content: [{ type: "text", text: `视频生成超时（等待了 ${MAX_WAIT / 1000}s），最后状态：${lastStatus}` }],
          isError: true,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `视频生成失败：${err.message}` }],
          isError: true,
        };
      }
    }

    case "agnes_video_status": {
      try {
        const result = await apiRequest("GET", `/v1/videos/generations/${args.request_id}`);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `查询失败：${err.message}` }],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [{ type: "text", text: `未知工具: ${name}` }],
        isError: true,
      };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("[agnes-video] 启动失败:", err);
  process.exit(1);
});
