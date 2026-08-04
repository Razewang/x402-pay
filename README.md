# Base + x402 付费 MCP 工具

这是一个可以直接插入 TypeScript MCP 项目的收款模块：调用方先收到 x402 付款要求，付款完成后服务端才执行 MCP 工具。

本项目固定使用 Coinbase Developer Platform（CDP）托管的生产 facilitator：

```text
https://api.cdp.coinbase.com/platform/v2/x402
```

它支持 Base 主网和 Base Sepolia。USDC 会直接进入你自己的 `PAY_TO` 地址；Coinbase 不托管你的收款资金，服务端也不需要收款钱包私钥。服务端只需要 CDP Secret API Key，用于生成访问 facilitator 所需的 JWT。

## 付款流程

1. MCP 客户端调用付费工具，但没有付款信息。
2. 服务端返回 x402 付款要求，其中包含金额、网络和 `PAY_TO`。
3. 客户端使用自己的付款钱包签署付款载荷，并在 `_meta["x402/payment"]` 中重试。
4. 服务端把付款交给 Coinbase CDP facilitator 验证。
5. 验证通过后执行工具，再让 facilitator 在链上结算。
6. USDC 从付款方进入你的 `PAY_TO`，工具结果和结算回执返回给客户端。

facilitator 负责付款验证、链上结算和结算交易的 Gas；它不持有买卖双方的资金。工具代码只会在付款验证通过后执行。

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
```

`X402_NETWORK` 的值为：

```text
Base 主网：eip155:8453
Base Sepolia：eip155:84532
```

即使使用 Base Sepolia，本项目仍然连接 Coinbase 的 CDP facilitator，不再回退到 `https://x402.org/facilitator`。

## 安装和运行示例

```bash
npm install
npm run typecheck
npm run dev
```

示例 MCP 服务注册了一个免费的 `ping` 工具和一个每次收费 `$0.001` USDC 的 `paid_add` 工具。

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

- 创建 Coinbase CDP facilitator client；
- 使用 `CDP_API_KEY_ID` 和 `CDP_API_KEY_SECRET` 对 facilitator 请求进行 JWT 认证；
- 注册 Base 的 `exact` EVM 付款方案；
- 查询 facilitator 支持的方案；
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

## 测试付款客户端

`examples/client.ts` 使用 CDP 管理的买家钱包，不需要把买家 EVM 私钥写入环境变量。除服务端的两个 CDP API 凭据外，还需要创建并配置 `CDP_WALLET_SECRET`：

```env
CDP_WALLET_SECRET=你的_CDP_Wallet_Secret
```

然后运行：

```bash
npx tsx examples/client.ts
```

测试 Base Sepolia 时，先把 `X402_NETWORK` 改为 `eip155:84532`，再为客户端打印出的 CDP 钱包地址领取测试 USDC。切换到主网后，客户端需要持有真实 Base USDC。

示例客户端配置了单笔 `0.02 USDC` 的最大付款额度，并会在调用前询问 `onPaymentRequested`。生产客户端应继续增加人工审批、余额限制和调用频率限制。

## 主网注意事项

- `PAY_TO` 是收款地址，不是 API Key，也不是私钥。
- `CDP_API_KEY_ID` 和 `CDP_API_KEY_SECRET` 是服务端身份凭据，必须保密。
- `CDP_WALLET_SECRET` 只用于示例买家，不需要放入收款服务器。
- Base 主网和 Base Sepolia 的地址格式相同，但资产和网络完全不同。
- 建议先用 Base Sepolia 验证，再用极小的主网金额验证 `PAY_TO`。
- 不要把工具结果当作已付款，除非 x402 wrapper 已经完成验证和结算。

## 关键文件

- `src/base-x402.ts`：可复用的 Coinbase CDP facilitator 收款 helper。
- `examples/server.ts`：免费工具和付费工具示例。
- `examples/client.ts`：使用 CDP 管理买家钱包自动付款的 MCP 客户端。
- `.env.example`：环境变量模板。

实现依据：[Coinbase x402 facilitator 文档](https://docs.cdp.coinbase.com/x402/core-concepts/facilitator)、[Coinbase 卖家快速入门](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers) 和 [CDP SDK 的 x402 接入](https://docs.cdp.coinbase.com/x402/core-concepts/cdp-sdk)。
