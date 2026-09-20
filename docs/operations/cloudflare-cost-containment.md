# Cloudflare 成本熔断与攻击用量运行手册

[Documentation index](../README.md)

> **适用范围：** PrepDeck 的 Workers、D1、KV、R2、Workers Logs、带宽与安全产品。本文不把
> 免费额度当作停服开关，也不把公开价目表当作账户合同。生产启用前，账户 Owner 与财务必须完成
> 下方签字表；未确认的项目按“可能继续服务并产生超额费用”处理。

## 当前实现与外部配置边界

已实现：HTTP `CIRCUIT_MODE`、Durable Object 分布式限流、原生导入限流、
`cloudflare-emergency.yml` 部署入口。生产日志为 **5%** head sampling，
`invocation_logs=false`；参见[日志运行手册](observability-runbook.md)。
下文的分钟级监控、独立 responder、WAF 规则、合同/告警/保留配置是待账户侧
配置和验证的运行方案，仓库不包含完整部署，也不证明这些控制已启用。

当前资源清单还包括 Worker 静态资源、Durable Objects 与 Email Sending；
不再按旧 Pages/Access 架构估算全部成本。任何演练都应使用独立环境。

## 1. 套餐、合同与超额计费逐项确认（上线门禁）

从 **Cloudflare Dashboard → Billing / Subscriptions**、已签署 Order Form、Enterprise 合同及每个
产品的 Usage 页面取值。截图/导出应存放在受限的审计库，**不要提交到本仓库**。每次续约、变更套餐
或至少每季度重新确认。

| 资源 | 账户实际套餐/合同 SKU | 包含量与计量单位 | 超额单价/阶梯/最低承诺 | 超额后行为（继续/限速/停止） | 硬上限是否可设 | 证据链接/日期/确认人 |
|---|---|---|---|---|---|---|
| Workers 请求、静态资源与 CPU | 待账户 Owner 确认 | 待确认 | 待确认 | **默认按可能继续计费** | 待确认 | 必填 |
| D1 rows read / rows written / storage | 待确认 | 待确认 | 待确认 | **默认按可能继续计费** | 待确认 | 必填 |
| Workers KV reads/writes/deletes/list/storage | 待确认 | 待确认 | 待确认 | **默认按可能继续计费** | 待确认 | 必填 |
| R2 Class A/Class B/storage/egress | 待确认 | 待确认 | 待确认 | **默认按可能继续计费** | 待确认 | 必填 |
| Workers Logs（写入、保留、查询） | 待确认 | 待确认 | 待确认 | **默认按可能继续计费** | 待确认 | 必填 |
| CDN/Worker 带宽与各目的地 egress | 待确认 | 待确认 | 待确认 | **默认按可能继续计费** | 待确认 | 必填 |
| WAF、Rate Limiting、Bot、DDoS、可选 Access | 待确认 | 待确认 | 待确认 | **默认按可能继续计费** | 待确认 | 必填 |
| Durable Objects 请求/存储/运行 | 待确认 | 待确认 | 待确认 | **默认按可能继续计费** | 待确认 | 必填 |
| Email Sending | 待确认 | 待确认 | 待确认 | **默认按可能继续计费** | 待确认 | 必填 |

验收条件：所有资源行都有合同页码或 Dashboard 证据；明确税费、计费周期、币种、日志保留、第三方市场
产品和折扣失效条件；由技术 Owner 与财务双签。月度 Budget Alert 仅作账务兜底，不能替代熔断。

## 2. 三级状态、短周期信号与动作

使用 Cloudflare GraphQL Analytics/API（或账户已有 SIEM）每 **1 分钟**拉取 1/5/15 分钟窗口；告警
必须同时看绝对量、相对基线和增长率。数据延迟超过 3 分钟本身是高危信号。建议初始状态如下，随后
用第 3 节计算值和非生产压测校准：

| 状态 | 触发（任一） | 自动动作 | 人工动作 |
|---|---|---|---|
| 正常 | 5 分钟预测月末用量 < 合同包含量 60%，且各资源 < 攻击上限 50% | 常规 WAF/rate limit；`CIRCUIT_MODE=normal` | 每周看趋势 |
| 降级 | 预测 ≥60%；或任一 1 分钟资源量 ≥上限 50%；或较 7 日同分钟 p95 高 3 倍 | `degraded`；收紧 edge rate limit；通知 on-call | 15 分钟内判因 |
| 紧急 | 预测 ≥85%；任一资源 ≥上限 80%；5 分钟斜率仍为正；或遥测中断 | `emergency`；部署 emergency WAF allowlist/维护模式 | 撤销攻击来源、决定回切 |

恢复必须人工批准：指标连续 15 分钟低于正常阈值，先 emergency→degraded 观察 15 分钟，再恢复 normal。
禁止告警自动直接恢复，避免抖动。当前 Worker 的生产日志配置为 5% head sampling，因此日志字节阈值
必须纳入同一监控；紧急时优先用新的已审查版本降低采样，不在事故中临时编辑代码。

## 3. 按资源计算“攻击上限”

先对每条路由在测试环境记录一次最坏情况操作数，填入清单。设：

- `R` = edge 放行请求/分钟；`W` = 单请求 Worker invocation（含 service binding/subrequest）；
- `Dr/Dw` = 单请求 D1 rows read/written；`Kr/Kw` = KV reads/writes；
- `R2r/R2w` = 单请求 R2 读取/写入字节；`L` = 单请求日志写入字节；
- `B_x` = 合同周期内该资源可接受的剩余额度；`M` = 周期剩余分钟；安全系数 `S=0.5`。

每种资源的请求速率硬上限分别为：

```text
worker_rpm = floor((B_worker / M) * S / W)
d1_read_rpm = floor((B_d1_read / M) * S / Dr)
d1_write_rpm = floor((B_d1_write / M) * S / Dw)
kv_read_rpm = floor((B_kv_read / M) * S / Kr)
kv_write_rpm = floor((B_kv_write / M) * S / Kw)
r2_read_rpm = floor((B_r2_read_bytes / M) * S / R2r)
r2_write_rpm = floor((B_r2_write_bytes / M) * S / R2w)
logs_rpm = floor((B_log_bytes / M) * S / L)
route_limit_rpm = min(以上所有适用上限, 业务容量上限)
```

分母为 0 的资源对该路由忽略，不能用平均值替代最坏值。导入还应分别计 R2 Class A 操作和写入字节；
下载分别计 Class B、读取字节与可能的 egress。将结果配置到 Cloudflare Rate Limiting Rules，按 route、
身份和 IP 分层；Worker 的 Durable Object limiter 是分布式计数边界；故障时普通读取的内存 fallback
只能作可用性缓冲，不能作为可靠的分布式成本边界。MCP 及导入还有各自额度。

建议建立版本化表格：`route, W, Dr, Dw, Kr, Kw, R2r, R2w, L, measured_at, build_sha`。对批量
SQL，以实际 rows read/written 而非 SQL 语句数计量；对失败、401/403/429 和最大合法 payload 都测量。

## 4. Worker 全局熔断语义

`CIRCUIT_MODE` 只能为 `normal`、`degraded`、`emergency`；未知值按 emergency 失败关闭。

- **degraded：** 允许只读请求；拒绝所有非 GET/HEAD/OPTIONS 写操作，并拒绝 AI 与导入读取路径，
  因而 AI 生成、导入、上传和其他写入均在认证与存储访问前返回 503。
- **emergency：** 仅放行最小 `/api/health`、无需存储的 `/api/auth/google/start` 与 `/api/auth/logout`，以及 `EMERGENCY_ADMIN_IPS` 中的精确
  来源。CIDR 必须由 WAF 规则实施；Worker 的精确 IP 检查只是纵深防御。管理员来源放行后仍执行正常
  身份/角色校验。
- 熔断中间件在 `src/index.ts` 中必须先于 API/MCP 路径的认证与限流执行。
  MCP 使用 POST，即使是只读 tool 也会在 degraded 被阻断；返回结构化 `unavailable`。
  Google callback 和本地密码登录会访问存储，emergency 下仍需来源 allowlist。
- Cron handler 不经过 HTTP 熔断；邮件与图片清理可能继续读写存储。需要阻断后台成本时，
  应另外停用目标环境 Cron 并验证；参考[定时任务](scheduled-jobs.md)。
- HTTP 熔断响应带 `Retry-After`、
  `Cache-Control: no-store` 和 `X-PrepDeck-Circuit`，且决策不读取 D1/KV/R2。

## 5. 高危告警自动化与最小权限

高危告警发送到一个**独立 responder**（独立 Worker/账户，不与受攻击服务共享配额或绑定）。目标流程（独立 responder 尚未在仓库实现）：

1. 验证告警来源 mTLS 或签名、时间戳和 nonce；去重并写入独立审计流。
2. 以资源类型、窗口、阈值和至少两个连续样本校验告警；遥测丢失走 emergency。
3. 使用限定单一 account/zone/script 的短期令牌，先部署预先测试的 emergency WAF ruleset，再把
   Worker 预构建只读版本提升为当前版本（或把配置切至 `emergency`）。禁止动态拼接规则表达式。
4. 读取部署状态并做 health probe；失败时切维护静态页。记录 request ID、版本、触发指标和哈希，
   同时寻呼，但不等待邮件确认。
5. responder **没有** D1/R2/KV 数据权限、DNS 全局编辑权、账户成员/令牌管理权或账单权限。

仓库提供的 `cloudflare-emergency.yml` 是可由 responder 发出 `cloudflare-cost-emergency` repository
dispatch 触发的最小自动化落点：它从事件选定的 checkout commit 构建并部署 emergency 配置，记录 `GITHUB_SHA`，不接受告警 payload 提供
规则或模式。`cloudflare-emergency` GitHub Environment 不应配置人工审批（否则不是自动响应），其中的
Cloudflare token 仅授予目标 Worker Script Edit。WAF 自动化应由独立 responder 使用另一个仅限目标
zone/ruleset 的 token 先行完成；两个 token 不得合并。人工 `workflow_dispatch` 只用于演练/故障兜底，
恢复 normal 必须走审查后的常规部署，绝不能由此工作流自动完成。

令牌从支持短期租约的 secret manager 注入，仅在执行时取得；最长 24 小时，自动轮换，生产与演练
分开。Cloudflare Audit Logs 导出到 responder 无写权限的独立目的地，对“创建令牌、修改 WAF、部署
Worker、修改路由”单独告警。每季度验证撤销；任何泄露立即撤销而不是只轮换。

## 6. 非生产熔断演练

必须用单独的非生产账户（次选：完全独立 zone、Worker、D1、KV、R2 与 token），不得复用生产绑定。

1. 固定测试 build SHA 和资源基线，开启 1 分钟采样；用最大合法 payload 持续压测至少 10 分钟。
2. 触发 degraded，确认 AI/import/upload/写请求在进入认证前得到 503，而 GET 仍可用。
3. 保持攻击不停止，触发 emergency；只有 health、恢复登录和 allowlist 管理来源可达。
4. **验收资源曲线而非告警：** 状态生效后留出 Analytics 延迟，先停用非本次测试的 Cron 并排除管理员/恢复流量，再确认连续 5 个窗口中被拒绝请求导致的
   D1 rows、KV ops、R2 ops/bytes 增量为 0；Worker invocation 只能保留 health/拒绝请求基线，日志字节与带宽应降到
   预算内拒绝响应的上限。若存储曲线仍增长，演练失败并保持 emergency。
5. 检查审计事件完整、token 权限拒绝越权 API、重复告警幂等、过期 token 失败、responder 故障时静态
   维护页接管。保存图表、窗口原始值、规则/版本 ID 和复盘结论。
6. 按分阶段恢复流程回切。每季度以及路由/套餐/合同变化后重演。

注意：熔断无法消除到达 Worker 的请求计费本身；必须由 edge WAF/rate limiting 在 Worker 前阻断高量
流量。Worker 熔断的目标是立即封住每次请求的 D1/KV/R2 与高成本功能放大系数。
