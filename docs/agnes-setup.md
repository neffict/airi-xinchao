# Agnes AI 图片/视频生成配置指南

## 1. 添加 API Key 到环境变量

编辑 `~/.hermes/.env`，添加：

```bash
AGNES_API_KEY=你的 Agnes AI API Key
```

获取 key：https://platform.agnes-ai.com

## 2. 启用 MCP 服务

编辑 `~/.hermes/config.yaml`，在 `mcp_servers` 下添加：

```yaml
mcp_servers:
  agnes-image:
    command: /path/to/airi-xinchao/bin/agnes-image.sh
    timeout: 120
  agnes-video:
    command: /path/to/airi-xinchao/bin/agnes-video.sh
    timeout: 300
```

编辑 Airi 的 `mcp.json`，添加：

```json
{
  "mcpServers": {
    "agnes-image": { "command": "/path/to/airi-xinchao/bin/agnes-image.sh" },
    "agnes-video": { "command": "/path/to/airi-xinchao/bin/agnes-video.sh" }
  }
}
```

## 3. 图片模型设置（可选）

在 `config.yaml` 中：

```yaml
image_gen:
  provider: agnes
  agnes:
    model: Agnes-Image-2.1-Flash # 或 Agnes-Image-2.0-Flash
```

## 4. 视频模型设置（可选）

```yaml
video_gen:
  provider: agnes
  agnes:
    model: agnes-video-v2.0
```

## 5. 验证

重启 Hermes 后测试：
- 图片：生成一张猫咪的图片
- 视频：生成一段海浪的视频

## API 信息

- Base URL：https://apihub.agnes-ai.com/v1
- 图片模型：Agnes-Image-2.0-Flash (~3s), Agnes-Image-2.1-Flash (~3s)
- 视频模型：agnes-video-v2.0 (~30-60s)，支持 text-to-video 和 image-to-video
- 默认免费
