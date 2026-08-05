# Base + x402 付费 MCP 工具

这是一个可以直接插入 TypeScript MCP 项目的 x402 收款模块。调用方先收到付款要求，完成付款后，服务端才执行对应的 MCP 工具。

项目同时包含：

- 可复用的付费工具包装器；
- 本地 `stdio` MCP 服务端示例；
- 远程 Streamable HTTP MCP 服务端示例；
- 本地与远程买方自动付款客户端示例。

本项目固定使用 Coinbase Developer Platform（CDP）托管的生产 Facilitator：

```text
https://api.cdp.coinbase.com/platform/v2/x402
```

它支持 Base 主网和 Base Sepolia。USDC 会直接进入你自己的 `PAY_TO` 地址；Coinbase 不托管你的收款资金，服务端也不需要收款钱包私钥。服务端只需要 CDP Secret API Key，用于生成访问 Facilitator 所需的 JWT。

## 架构

```text
买方 MCP 客户端
    │
    │ stdio 或 Streamable HTTP
    ▼
付费 MCP 工具
    │
    │ x402 验证与结算请求
    ▼
Coinbase CDP Facilitator
    │
    │ Base USDC
    ▼
PAY_TO 收款地址
```

买方客户端必须具备 x402 付款能力。仅将远程 MCP URL 添加到普通客户端，并不会自动完成付款；客户端还需要使用 `@x402/mcp`、Coinbase Payments MCP，或其他兼容的 x402 支付实现。

## 付款流程

1. MCP 客户端调用付费工具，但没有付款信息。
2. 服务端返回 x402 付款要求，其中包含金额、网络和 `PAY_TO`。
3. 客户端使用自己的付款钱包签署付款载荷，并在 `_meta["x402/payment"]` 中重试。
4. 服务端把付款交给 Coinbase CDP Facilitator 验证。
5. 验证通过后执行工具，再让 Facilitator 在链上结算。
6. USDC 从付款方进入你的 `PAY_TO`，工具结果和结算回执返回给客户端。

Facilitator 负责付款验证、链上结算和结算交易的 Gas；它不持有买卖双方的资金。工具代码只会在付款验证通过后执行。

## 准备 CDP 凭据

在 Coinbase Developer Platform 中：

1. 创建 Project。
2. 打开 **API Keys**。
3. 创建 **Secret API Key**。
4. 保存 Key ID 和 Key Secret。

不要使用 Client API Key。Secret API Key 只能放在 MCP 服务端，不能写入前端、提交到 Git 或分享给付款客户端。

准备一个由你自己控制的 Base EVM 地址作为收款地址。这里只需要公开地址，不需要它的私钥。

## 配置环境变量

```bash
cp .env.example .env
```

填写 `.env`：

```env
CDP_API_KEY_ID=你的_CDP_Secret_API_Key_ID
CDP_API_KEY_SECRET=你的_CDP_Secret_API_Key_Secret
PAY_TO=0x你的Base收款地址

# Base 主网；测试时可改为 eip155:84532
X402_NETWORK=eip155:8453

# 可选：示例工具价格
PAID_ADD_PRICE=$0.001

# 远程服务端监听端口
PORT=8787

# 远程买方客户端连接地址
MCP_URL=http://localhost:8787/mcp

# 仅买方示例需要；收款服务器不需要
CDP_WALLET_SECRET=你的_CDP_Wallet_Secret
```

`X402_NETWORK` 可选值：

```text
Base 主网：eip155:8453
Base Sepolia：eip155:84532
```

即使使用 Base Sepolia，本项目仍然连接 Coinbase 的 CDP Facilitator，不会回退到 `https://x402.org/facilitator`。

## 安装

```bash
npm install
npm run typecheck
```

示例注册了：

- `ping`：免费健康检查；
- `paid_add`：默认每次收费 `$0.001` USDC。

## 运行本地 stdio 服务端

```bash
npm run dev
```

也可以直接运行：

```bash
npx tsx examples/server.ts
```

这个模式适合 Claude Desktop、Claude Code、Codex CLI 等在本地启动 MCP 子进程的客户端。

## 运行本地买方自动付款示例

`examples/client.ts` 会自动启动本地 `stdio` 服务端，调用 `paid_add`，收到付款要求后使用 CDP 管理的买方钱包付款并重试。

```bash
npx tsx examples/client.ts
```

流程：

```text
examples/client.ts
    │ 启动 stdio 子进程
    ▼
examples/server.ts
    │ 返回 x402 付款要求
    ▼
CDP 买方钱包自动付款
    │
    ▼
paid_add 返回结果
```

## 运行远程 Streamable HTTP 服务端

启动远程 MCP 服务：

```bash
npx tsx examples/remote-server.ts
```

默认监听：

```text
http://localhost:8787/mcp
```

可通过环境变量修改端口：

```bash
PORT=3000 npx tsx examples/remote-server.ts
```

远程服务端为每个 MCP 会话创建独立的 `McpServer` 和 `StreamableHTTPServerTransport`，并在内存中保存会话状态。

生产部署时应注意：

- 必须使用 HTTPS；
- 为 `/mcp` 增加身份验证、限流和请求大小限制；
- 当前示例把会话保存在单进程内存中，适合单实例 Node.js 服务；
- 多实例部署需要粘性会话或共享会话存储；
- 进程重启会使现有 MCP 会话失效，客户端需要重新初始化；
- 不要将 `CDP_API_KEY_SECRET` 暴露给买方客户端。

适合部署到长期运行的 Node.js 环境，例如 VPS、容器或支持持久进程的云服务。直接部署到无状态 Serverless Function 前，需要先改造会话管理。

## 运行远程买方自动付款客户端

先启动远程服务端：

```bash
npx tsx examples/remote-server.ts
```

再打开另一个终端运行：

```bash
MCP_URL=http://localhost:8787/mcp npx tsx examples/remote-client.ts
```

远程买方客户端会：

1. 使用 `StreamableHTTPClientTransport` 连接远程 `/mcp`；
2. 调用 `paid_add`；
3. 接收 x402 付款要求；
4. 使用 CDP 管理的买方钱包付款；
5. 自动重试工具调用并输出结果。

流程：

```text
examples/remote-client.ts
    │ Streamable HTTP
    ▼
examples/remote-server.ts /mcp
    │ x402 付款要求
    ▼
CDP 买方钱包自动付款
    │
    ▼
远程工具结果
```

示例客户端限制单笔最大付款为 `0.02 USDC`，并在 `onPaymentRequested` 回调中记录报价。当前示例自动批准符合 CDP `spendControls` 的付款；生产客户端应增加人工审批、域名白名单、每日额度和调用频率限制。

## 接入远程 AI 客户端

远程 MCP 地址是：

```text
https://你的域名/mcp
```

客户端必须同时满足：

1. 支持 MCP Streamable HTTP；
2. 支持 x402 付款扩展，或通过支付 MCP/代理包装调用。

普通 MCP 客户端若不理解 x402，第一次调用付费工具时只会收到付款要求，无法自动付款。可以参考 `examples/remote-client.ts`，使用：

```ts
const rawClient = new Client({
  name: "my-x402-client",
  version: "1.0.0",
});

const client = wrapMCPClientWithPayment(rawClient, paymentClient, {
  autoPayment: true,
  onPaymentRequested: async ({ paymentRequired }) => {
    const quote = paymentRequired.accepts[0];
    // 在这里检查域名、金额、资产和网络。
    return quote.network === "eip155:8453";
  },
});

await client.connect(
  new StreamableHTTPClientTransport(
    new URL("https://你的域名/mcp"),
  ),
);
```

## 插入现有 MCP 项目

把 `src/base-x402.ts` 复制到项目中，然后在注册工具时包装原有处理函数：

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createBaseX402Receiver } from "./base-x402.js";

const server = new McpServer({ name: "my-paid-mcp", version: "1.0.0" });

const payments = await createBaseX402Receiver({
  payTo: process.env.PAY_TO!,
  network: "eip155:8453",
});

const paidSearch = await payments.createPaidTool(
  {
    toolName: "premium_search",
    price: "$0.01",
    description: "Premium search results",
  },
  async ({ query }) => {
    const data = await runYourExistingSearch(query);
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

server.tool(
  "premium_search",
  "Premium search. Costs $0.01 USDC on Base per call.",
  { query: z.string().min(1) },
  paidSearch,
);
```

初始化 `createBaseX402Receiver()` 时会：

- 创建 Coinbase CDP Facilitator client；
- 使用 `CDP_API_KEY_ID` 和 `CDP_API_KEY_SECRET` 对 Facilitator 请求进行 JWT 认证；
- 注册 Base 的 `exact` EVM 付款方案；
-查询 Facilitator 支持的方案；
- 为每个工具生成独立的付款要求。

每个工具可以单独定价：

```ts
const cheap = await payments.createPaidTool(
  { toolName: "cheap", price: "$0.001" },
  cheapHandler,
);

const expensive = await payments.createPaidTool(
  { toolName: "expensive", price: "$0.10" },
  expensiveHandler,
);
```

## 买方钱包说明

`examples/client.ts` 和 `examples/remote-client.ts` 使用 CDP 管理的买方钱包，不需要把买方 EVM 私钥写入环境变量，但需要：

```env
CDP_WALLET_SECRET=你的_CDP_Wallet_Secret
```

测试 Base Sepolia 时，先将 `X402_NETWORK` 改为 `eip155:84532`，再为客户端使用的 CDP 钱包地址准备测试 USDC。切换到主网后，客户端需要持有真实 Base USDC。

`CDP_WALLET_SECRET` 只属于买方示例，不应部署到收款服务器，也不应与服务端 CDP Secret API Key 混用。

## 主网安全注意事项

- `PAY_TO` 是收款地址，不是 API Key，也不是私钥。
- `CDP_API_KEY_ID` 和 `CDP_API_KEY_SECRET` 是服务端身份凭据，必须保密。
- `CDP_WALLET_SECRET` 只用于示例买家，不需要放入收款服务器。
- Base 主网和 Base Sepolia 的地址格式相同，但资产和网络完全不同。
- 建议先用 Base Sepolia 验证，再用极小的主网金额验证 `PAY_TO`。
- 买方客户端必须设置单笔、每日和会话总额度。
- 自动付款前应验证工具名、目标域名、网络、资产和金额。
- 不要把工具结果当作已付款，除非 x402 wrapper 已经完成验证和结算。

## 关键文件

- `src/base-x402.ts`：可复用的 Coinbase CDP Facilitator 收款 helper。
- `examples/demo-server.ts`：本地与远程示例共享的 MCP 工具注册逻辑。
- `examples/server.ts`：本地 `stdio` MCP 服务端。
- `examples/client.ts`：本地 `stdio` 买方自动付款客户端。
- `examples/remote-server.ts`：远程 Streamable HTTP MCP 服务端。
- `examples/remote-client.ts`：远程买方自动付款客户端。
- `.env.example`：环境变量模板。

实现依据：[Coinbase x402 Facilitator 文档](https://docs.cdp.coinbase.com/x402/core-concepts/facilitator)、[Coinbase 卖家快速入门](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers)、[CDP SDK 的 x402 接入](https://docs.cdp.coinbase.com/x402/core-concepts/cdp-sdk) 和 [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。
