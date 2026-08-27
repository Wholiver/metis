# Metis Desktop Server 接入说明

本文档面向 Desktop / Web 前端开发者与后续接入 AI。Server 模式参考 OpenCode 架构：单个长期运行的本地 HTTP 服务，通过 REST 修改状态，通过 SSE 推送 Agent 事件，并发布 OpenAPI 3.1 描述。

## 1. 启动

```bash
metis server
metis server --hostname 127.0.0.1 --port 4096
metis server --cors http://localhost:5173 --cors http://tauri.localhost
```

兼容入口：`metis serve`、`metis --mode server`。

默认地址为 `http://127.0.0.1:4096`。传 `--port 0` 可让系统选择空闲端口；实际 URL 会输出到 stderr。

环境变量：

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `METIS_SERVER_USERNAME` | HTTP Basic Auth 用户名 | `metis` |
| `METIS_SERVER_PASSWORD` | 启用 HTTP Basic Auth | 未设置 |

安全约束：监听 `localhost`、`127.0.0.0/8`、`::1` 以外的地址时必须设置密码。浏览器 Origin 默认不允许；每个可信 Origin 都要单独传一次 `--cors`。原生客户端不发送 `Origin`，无需 CORS。

## 2. 客户端启动顺序

1. 启动子进程 `metis server`，从 stderr 读取 `server listening on <url>`。
2. 轮询 `GET /global/health`，直到返回 `200`。
3. 打开 `GET /event` SSE 流。第一条事件必须为 `server.connected`。
4. 读取 `GET /session`、`GET /session/messages`，恢复界面。
5. 用 `POST /session/prompt` 发消息；从 SSE 渲染流式事件，不要等待 prompt HTTP 连接承载生成结果。
6. Desktop 退出前终止 server 子进程；server 收到 `SIGINT`、`SIGTERM`、`SIGHUP` 后会关闭连接并释放 session。

## 3. 通用协议

所有普通响应均为 JSON。错误统一为：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "message must be a non-empty string"
  }
}
```

`POST` / `PUT` 请求使用 `Content-Type: application/json`。请求体上限 10 MiB。认证开启时，每个 HTTP 和 SSE 请求都带：

```http
Authorization: Basic base64(username:password)
```

机器可读协议：

- `GET /openapi.json`：OpenAPI 3.1 JSON。
- `GET /doc`：同一 OpenAPI 文档的兼容别名。

## 4. REST API

| 方法 | 路径 | 请求体 / 参数 | 返回 |
| --- | --- | --- | --- |
| `GET` | `/global/health` | 无 | `{ healthy, version }` |
| `GET` | `/event` | 无 | SSE 事件流 |
| `GET` | `/session` | 无 | 当前 session 状态，含 `thinkingLevel`、`thinkingLevels`、`supportsThinking` |
| `GET` | `/sessions?cwd=<path>` | `cwd` 可选，默认当前工作目录 | `{ cwd, sessions }` |
| `GET` | `/session/messages` | 无 | `{ messages }` |
| `GET` | `/session/entries?since=<id>` | `since` 可选 | `{ entries, leafId }` |
| `GET` | `/session/tree` | 无 | `{ tree, leafId }` |
| `GET` | `/config/providers` | 无 | `{ models }` |
| `POST` | `/session/prompt` | `{ message, images?, streamingBehavior? }` | `202 { accepted: true }` |
| `POST` | `/session/steer` | `{ message, images? }` | `{ success: true }` |
| `POST` | `/session/follow-up` | `{ message, images? }` | `{ success: true }` |
| `POST` | `/session/abort` | 无 | `{ success: true }` |
| `POST` | `/session/compact` | `{ customInstructions? }` 或空体 | compaction 结果 |
| `POST` | `/session/new` | `{ cwd?, parentSession? }` 或空体 | session 切换结果；`cwd` 可切换工作项目 |
| `POST` | `/session/switch` | `{ sessionPath }` | session 切换结果 |
| `POST` | `/session/fork` | `{ entryId }` | fork 结果 |
| `PUT` | `/session/model` | `{ provider, modelId }` | 新模型对象 |
| `PUT` | `/session/thinking` | `{ level }`，必须来自当前 `thinkingLevels` | `{ success: true, level }` |
| `PUT` | `/session/name` | `{ name }` | `{ success: true }` |
| `POST` | `/extension/ui-response` | `RpcExtensionUIResponse` | `{ success: true }` |

`streamingBehavior` 可为 `steer` 或 `followUp`。Agent 正在生成时必须显式提供，决定新消息立即引导当前 turn，还是排队到当前 turn 后执行。

图片沿用 Metis `ImageContent`：

```ts
type ImageContent = {
  type: "image";
  data: string;      // base64，不带 data: URL 前缀
  mimeType: string;
};
```

## 5. SSE 事件

每个 SSE frame 只使用 `data:`，内容为一个 JSON 对象：

```text
data: {"type":"server.connected","properties":{"version":"1.1.0-rc.1"}}

data: {"type":"message_start",...}

```

事件为 `type` 判别联合：

- `server.connected`：连接建立后的第一条事件。
- `server.heartbeat`：每 25 秒一次，用于保活。
- `AgentSessionEvent`：与 `src/core/agent-session.ts` 中的事件完全一致；包括 message、tool execution、compaction、model/thinking change 等。
- `extension_ui_request`：扩展请求 Desktop 展示 UI；需通过 `/extension/ui-response` 回传相同 `id`。
- `extension_error`：扩展事件执行失败。

断线处理：使用指数退避重连；重新连接后先 `GET /session` 和 `/session/entries?since=<lastEntryId>` 补状态。SSE 只负责实时通知，不保证离线事件重放。

## 6. 最小 TypeScript 客户端

```ts
const baseUrl = "http://127.0.0.1:4096";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(baseUrl + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw await response.json();
  return response.json() as Promise<T>;
}

const events = new EventSource(baseUrl + "/event");
events.onmessage = (message) => {
  const event = JSON.parse(message.data) as { type: string };
  switch (event.type) {
    case "server.connected":
      void request("/session").then(restoreSession);
      break;
    case "extension_ui_request":
      void showExtensionDialog(event);
      break;
    default:
      reduceAgentEvent(event);
  }
};

await request("/session/prompt", {
  method: "POST",
  body: JSON.stringify({ message: "解释当前项目" }),
});
```

浏览器原生 `EventSource` 不能自定义 `Authorization` header。启用 Basic Auth 时，Desktop 应使用支持 header 的 SSE 客户端，或在本地回环地址下不设置密码。

## 7. 代码导航

| 文件 | 责任 |
| --- | --- |
| `server-mode.ts` | HTTP、SSE、认证、CORS、session 生命周期与路由 |
| `server-types.ts` | 前端可复用的公开 TypeScript 类型 |
| `openapi.ts` | 运行时 OpenAPI 3.1 文档 |
| `test/server-mode.test.ts` | 协议行为与安全回归测试 |

公共 SDK 从包根导出 `startServerMode`、`runServerMode`、`createServerOpenApiDocument` 及全部 `Server*` 类型。前端生成 SDK 时，以运行中 server 返回的 `/openapi.json` 为准。

