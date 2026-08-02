const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const AGNES_BASE_URL = "https://apihub.agnes-ai.com/v1";
const API_KEY = process.env.AGNES_API_KEY || "";

const MODELS = {
  "Agnes-Image-2.0-Flash": { display: "Agnes Image 2.0 Flash", speed: "~3s" },
  "Agnes-Image-2.1-Flash": { display: "Agnes Image 2.1 Flash", speed: "~3s" },
};
const DEFAULT_MODEL = "Agnes-Image-2.0-Flash";
const SIZES = { landscape: "1536x1024", square: "1024x1024", portrait: "1024x1536" };
const CACHE_DIR = path.join(process.env.HOME, ".agnes-cache", "images");

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function apiRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: "apihub.agnes-ai.com",
      path: "/v1/images/generations",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

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
    req.write(body);
    req.end();
  });
}

function downloadToFile(url, prefix) {
  return new Promise((resolve, reject) => {
    ensureCacheDir();
    const ext = ".png";
    const filename = `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`;
    const filepath = path.join(CACHE_DIR, filename);

    const file = fs.createWriteStream(filepath);
    https.get(url, { headers: { Authorization: `Bearer ${API_KEY}` } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, { headers: { Authorization: `Bearer ${API_KEY}` } }, (res2) => {
          res2.pipe(file);
          file.on("finish", () => { file.close(); resolve(filepath); });
        });
      } else {
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(filepath); });
      }
    }).on("error", (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}

// ─── MCP Server ─────────────────────────────────────────

const server = new Server(
  { name: "agnes-image", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "agnes_generate_image",
      description: "使用 Agnes AI 生成图片。输入文字描述，返回生成的图片路径。",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "图片描述（中文/英文均可）" },
          model: {
            type: "string",
            enum: Object.keys(MODELS),
            description: "使用的模型",
          },
          aspect_ratio: {
            type: "string",
            enum: ["landscape", "square", "portrait"],
            description: "图片比例：landscape(16:10) / square(1:1) / portrait(9:16)",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "agnes_list_models",
      description: "列出 Agnes AI 可用的图片生成模型。",
      inputSchema: { type: "object", properties: {} },
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
    case "agnes_generate_image": {
      try {
        const model = args.model || DEFAULT_MODEL;
        const aspect = args.aspect_ratio || "square";
        const size = SIZES[aspect] || SIZES.square;

        ensureCacheDir();

        const payload = {
          model,
          prompt: args.prompt,
          size,
          n: 1,
        };

        const result = await apiRequest(payload);

        if (!result.data || !result.data[0]) {
          return {
            content: [{ type: "text", text: `Agnes 返回空数据：${JSON.stringify(result)}` }],
            isError: true,
          };
        }

        const item = result.data[0];
        let imagePath;
        if (item.b64_json) {
          const filename = `agnes_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.png`;
          imagePath = path.join(CACHE_DIR, filename);
          fs.writeFileSync(imagePath, Buffer.from(item.b64_json, "base64"));
        } else if (item.url) {
          imagePath = await downloadToFile(item.url, "agnes");
        } else {
          return {
            content: [{ type: "text", text: `Agnes 返回了没有图片数据的响应：${JSON.stringify(result).slice(0, 200)}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `图片已生成并保存到：${imagePath}\n模型：${model}\n尺寸：${size}\n描述：${args.prompt}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `图片生成失败：${err.message}` }],
          isError: true,
        };
      }
    }

    case "agnes_list_models": {
      const lines = Object.entries(MODELS)
        .map(([id, meta]) => `- ${id}：${meta.display}（${meta.speed}，免费）`)
        .join("\n");
      return {
        content: [{ type: "text", text: `Agnes AI 图片模型：\n${lines}` }],
      };
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
  console.error("[agnes-image] 启动失败:", err);
  process.exit(1);
});
