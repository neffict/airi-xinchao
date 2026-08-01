# Airi 心潮 (airi-xinchao)

心潮动态心智引擎的 stdio MCP 版本，为 Airi (17岁元气少女) 设计的轻量级 AI 状态管理工具。

## 和原版心潮的区别

| 特性 | 原版心潮 | airi-xinchao |
|------|---------|--------------|
| 传输 | HTTP 长连接 | stdio 短生命周期 |
| 部署 | 需要常驻服务 + Node.js | 单文件工具，随 Airi 启动 |
| 状态存储 | JSON 文件 | JSON 文件 |
| 模型 | 可选 LLM | 纯本地计算，不烧 token |
| 集成方式 | MCP HTTP | MCP stdio |

## 工具列表

| 工具 | 说明 |
|------|------|
| `xinchao_context` | 获取当前状态描述，注入 prompt |
| `xinchao_event` | 回传互动事件，更新状态 |
| `xinchao_status` | 查看完整状态详情 |
| `xinchao_settle` | 手动结算 |
| `xinchao_mood` | 获取心情/能量判断 |

## 安装

1. 克隆或下载本仓库
2. 在 Airi 的 MCP 配置里添加：

```json
{
  "xinchao": {
    "command": "/Users/macbook/airi-xinchao/bin/xinchao.sh"
  }
}
```

3. 在 Airi 角色卡的 prompt 里加一行：

```
{{xinchao_context}}
```

## 驱动力系统

十二维驱动力影响 Airi 的回复风格：

- **表达欲(express)** > 0.55 → 更话多、更主动
- **关心欲(care)** > 0.6 → 会主动追问近况
- **玩心(play)** > 0.55 → 语气更轻松俏皮
- **学习欲(learn)** > 0.5 → 更愿意分享知识
- **疲惫度(fatigue)** > 0.7 → 回复变短变安静

状态文件在 `state/xinchao_state.json`。

## License

MIT
