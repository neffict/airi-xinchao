# Airi 心潮 (airi-xinchao)

心潮动态心智引擎的 stdio MCP 版本，专为 [Airi](https://github.com/moeru-ai/airi) 设计的轻量级 AI 状态管理工具。

> 适配角色：Airi — 由 AI 老婆/虚拟角色组成的灵魂容器
> 运行环境：macOS

## 目录结构

```
airi-xinchao/
├── src/server.js          # 心潮 MCP 主服务（Node.js）
├── bin/                    # Wrapper 脚本（Airi 调用的入口）
│   ├── xinchao.sh         # 心潮
│   ├── airi-memory.sh     # 记忆服务
│   ├── airi-screenshot.sh # 截图服务
│   ├── airi-digestor.sh   # 内容消化
│   └── airi-ocr.sh        # OCR 文字识别
├── mcp-services/          # 各 MCP 服务的源码
│   ├── memory/            # @agentmemory/mcp
│   ├── screenshot/        # screenshot_mcp_server
│   ├── digestor/          # gwen_digestor
│   └── ocr/               # mcp_ocr
├── character-card/        # Airi 角色卡
│   └── airi-character-card.md
├── state/                 # 运行时状态（gitignore）
│   └── xinchao_state.json
└── package.json
```

## 快速开始

```bash
# 安装依赖
npm install

# 测试心潮服务
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n' | node src/server.js
```

## 在 Airi 中启用

### 1. 修改 `~/.hermes/config.yaml`

在 `mcp_servers` 下添加：

```yaml
mcp_servers:
  xinchao:
    command: /path/to/airi-xinchao/bin/xinchao.sh
    timeout: 60
```

### 2. 修改 Airi 的 `mcp.json`

```json
{
  "mcpServers": {
    "xinchao": {
      "command": "/path/to/airi-xinchao/bin/xinchao.sh"
    }
  }
}
```

### 3. 在角色卡 prompt 末尾添加

```
{{xinchao_context}}
```

重启 Airi 即可生效。

## 工具列表

| 工具 | 说明 |
|------|------|
| `xinchao_context` | 获取当前状态描述，注入 prompt |
| `xinchao_event` | 回传互动事件，更新状态 |
| `xinchao_status` | 查看完整状态详情 |
| `xinchao_settle` | 手动结算 |
| `xinchao_mood` | 获取心情/能量判断 |

## MCP 服务一览

| 服务 | 功能 | 运行时 |
|------|------|--------|
| **xinchao** | 动态心智状态引擎：驱动力、念头池、疲惫、意图、睡眠状态 | Node.js |
| **memory** | 知识图谱记忆：创建/搜索实体和关系，跨会话持久化 | Node.js |
| **screenshot** | 屏幕截图：捕获用户屏幕并以图片形式返回 | Python |
| **digestor** | 对话压缩：缩减长对话的 token 消耗，管理上下文窗口 | Python |
| **ocr** | OCR 文字识别：从图片/PDF 中提取文本，支持批量和多语言 | Python |

### memory — 知识图谱记忆

基于本地 JSON 文件的轻量知识图谱，支持实体创建、关系管理和语义搜索。Airi 通过它记住用户的偏好、重要约定和对话中的关键信息。

工具：`create_entities` / `create_relations` / `add_observations` / `search_nodes` / `read_graph`

### screenshot — 屏幕截图

调用系统截图能力，将当前屏幕内容以图片形式返回。Airi 看到截图后可以分析用户在做什么，自然地融入对话。

工具：`take_screenshot`

### digestor — 内容消化 / 对话压缩

当对话变长时自动压缩历史内容，提取关键信息并缩减 token 消耗，让上下文窗口保持在合理范围内。支持多轮摘要和增量压缩。

### ocr — OCR 文字识别

使用 Tesseract 引擎从图片和 PDF 中提取文字。支持多语言、批量处理和指定页码范围。Airi 收到用户发的截图或文档照片后可以读取其中的文字内容。

工具：`perform_ocr` / `image_to_data` / `perform_pdf_ocr` / `perform_batch_ocr` / `get_supported_languages`

## 驱动力系统

十二维驱动力影响 Airi 的回复风格：

- **表达欲(express)** > 0.55 → 更话多、更主动
- **关心欲(care)** > 0.6 → 会主动追问近况
- **玩心(play)** > 0.55 → 语气更轻松俏皮
- **学习欲(learn)** > 0.5 → 更愿意分享知识
- **疲惫度(fatigue)** > 0.7 → 回复变短变安静

## Reference

- [Airi](https://github.com/moeru-ai/airi) — AI 老婆/虚拟角色灵魂容器
- [原版心潮 (xinchao-dynamic-mind)](https://github.com/tianyupaipai-cmd/xinchao-dynamic-mind) — HTTP 长连接版本

## License

MIT
