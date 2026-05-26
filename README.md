# Lossless Tavern

SillyTavern 无损上下文管理脚本，基于 [lossless-claw](https://github.com/Martian-Engineering/lossless-claw) 的设计理念。

## 功能

- **DAG 摘要系统**：将旧消息压缩为分层摘要，保留关键信息
- **自动压缩**：当上下文接近窗口限制时自动触发压缩
- **独立 API**：支持配置独立的 OpenAI 兼容 API 用于摘要
- **SQLite 存储**：使用 sql.js (WASM) 在浏览器端运行 SQLite，数据持久化到 IndexedDB
- **全文搜索**：基于 FTS5 的 grep 搜索功能
- **摘要检索**：describe 查看摘要详情，expand 展开恢复原始内容
- **上下文注入**：自动将摘要注入到 prompt 中

## 使用方法

### 1. 安装依赖

```bash
cd lossless-tavern
npm install
```

### 2. 构建

```bash
npm run build
```

生成的文件在 `dist/lossless-tavern.js`。

### 3. 加载到 SillyTavern

通过 JS-Slash-Runner 加载 `dist/lossless-tavern.js` 作为脚本。

### 4. 配置

点击右下角的 **LCM** 按钮，进入 Config 标签页配置：

| 配置项 | 说明 |
|--------|------|
| API URL | OpenAI 兼容的 API 地址 |
| API Key | API 密钥 |
| Model | 用于摘要的模型 |
| Context Threshold | 触发压缩的上下文使用比例 (0-1) |
| Fresh Tail Count | 保留的最近消息数量 |
| Leaf Chunk Tokens | 叶子摘要的源消息 token 上限 |
| Leaf Target Tokens | 叶子摘要的目标 token 数 |

## 架构

```
src/
├── index.ts         # 入口，事件注册，生命周期管理
├── types.ts         # 类型定义
├── config.ts        # 配置管理 (localStorage)
├── api-client.ts    # LLM API 客户端
├── storage.ts       # SQLite 存储层 (sql.js + IndexedDB)
├── dag.ts           # DAG 摘要节点管理
├── tokenizer.ts     # Token 估算
├── compaction.ts    # 压缩引擎 (叶子 + 凝缩)
├── assembler.ts     # 上下文组装
├── retrieval.ts     # 检索引擎 (grep/describe/expand)
└── ui.ts            # 设置界面
```

## 工作原理

1. 每条消息到达时存入 SQLite 数据库
2. 当总 token 数超过上下文窗口的阈值时触发压缩
3. 压缩过程：选取最旧的消息块 → 调用 LLM 生成摘要 → 隐藏原始消息 → 注入摘要到 prompt
4. 摘要可以进一步压缩为更高层级的摘要（DAG 结构）
5. 每次生成前，自动将摘要注入到对话上下文的最前面

## 开发

```bash
npm run build:dev   # 开发构建（带 sourcemap）
npm run watch       # 监听模式
```
