# Task 3 Architecture Decision Record

## Settlement Intelligence Engine V1

- Status: FROZEN
- Scope: Task 3 开发前架构基线
- Mode: Shadow Mode

## 1. Settlement Intelligence Engine V1 目标

Settlement Intelligence Engine V1 用于统一分析 VND 结算运营中的资金、汇率、库存成本、商户收益、利润和风险数据，并生成可解释、可追溯的运营建议。

系统目标：

- 生成补U建议，但不执行补U。
- 生成商户报价建议，但不修改报价。
- 预测日内流动性和 16:00–23:00 资金压力。
- 同时计算和展示 Cash Profit 与 Economic Profit。
- 识别余额、利润、汇率、交易集中度和数据完整性风险。
- 保存建议生成时使用的输入、规则、计算结果和证据。
- 支持后续通过 Lark 发送只读提醒，但不发送执行指令。

## 2. Rule Engine 与 AI 职责边界

### Rule Engine

Rule Engine 负责所有确定性计算和业务约束，包括：

- Gross、Reserve、Settleable 三层资金计算。
- 50% Settleable 比例和 10% 安全缓冲。
- Payin、Payout、Topup及内部划转的资金影响。
- FIFO VND 库存成本。
- 千2市场保护线和千5目标线判断。
- Cash Profit 与 Economic Profit 计算。
- 流动性缺口、补U数量和风险等级计算。
- 数据完整性、截止时间和规则版本校验。

### AI

AI 只能基于 Rule Engine 的结构化结果：

- 归纳运营情况。
- 解释建议原因。
- 总结风险和数据缺口。
- 生成面向运营人员的自然语言建议。
- 对多个确定性结果进行优先级排序。

AI不得：

- 修改 Rule Engine 的计算结果。
- 虚构缺失数据、汇率、时间或执行结果。
- 绕过业务规则或权限。
- 生成或触发任何自动执行动作。

当 AI 输出与 Rule Engine 结果不一致时，以 Rule Engine 结果为准，并记录异常。

## 3. Shadow Mode 限制

Settlement Intelligence Engine V1 始终保持 Shadow Mode。

允许：

- 只读聚合数据。
- 计算预测和风险。
- 生成、保存和展示建议。
- 保存后续实际结果用于效果评估。
- 发送不包含执行能力的提醒。

禁止：

- 自动补U。
- 自动付款。
- 自动修改客户报价。
- 自动交易。
- 自动切换通道。
- 自动上传或提交第三方付款文件。
- 通过 API、任务队列或后台作业间接执行资金操作。

所有页面、API和通知必须明确标识建议性质，不得将建议展示为已批准或已执行。

## 4. Evidence Chain 设计原则

每条建议必须建立完整 Evidence Chain：

1. 原始数据来源和记录标识。
2. 各数据源的 `as_of` 和截止时间。
3. 输入快照及其不可变数据指纹。
4. 数据完整性状态和缺失区间。
5. 生效的业务规则及规则版本。
6. Rule Engine 的中间计算和最终结果。
7. AI使用的结构化上下文及模型版本。
8. 最终建议、理由、风险和置信度。
9. 后续实际结果和效果评价。

任何用户可见的关键数字都必须能够追溯至输入数据和确定性计算。数据不足时必须降级置信度并显示缺失提示，不得通过推测补齐。

## 5. Recommendation 不可变原则

系统建议一经生成即不可覆盖或删除。

要求：

- 每次建议使用唯一ID和版本号。
- 保存建议生成时的输入快照、规则版本和模型版本。
- 重新计算必须创建新建议版本。
- 旧建议保留原始状态和完整审计信息。
- 被新版本替代的建议只可标记为 `SUPERSEDED`。
- 后续实际结果作为独立记录关联，不回写原建议内容。
- 不允许通过更新建议记录表达人工修改或审批结果。

## 6. 数据模型设计原则

Task 3 数据模型应遵循：

- 输入快照、引擎运行、建议、风险和预测结果分层保存。
- 确定性计算结果与 AI 自然语言输出分开保存。
- 所有金额明确币种、精度、正负方向和业务含义。
- Gross、Reserve、Settleable 不得混用。
- Cash Profit 与 Economic Profit 必须同时保存。
- 所有记录包含 `as_of`、数据截止时间、规则版本和模型版本。
- 历史记录不可覆盖；修正通过新版本和 `SUPERSEDED` 状态完成。
- 使用外键、唯一约束、索引、RLS、最小权限和审计日志。
- 不同币种的数据和规则相互隔离，VND作为首个实现。
- 复用现有学习、日报和运营数据结构，不重复建立审批体系。

建议的逻辑实体包括：

- Engine Run
- Input Snapshot
- Ruleset Version
- Liquidity Forecast
- Profit Forecast
- FX Intelligence Snapshot
- Risk Signal
- Recommendation
- Recommendation Outcome
- Notification Delivery

本ADR不授权创建或修改任何数据库对象。

## 7. Task 3 开发顺序

1. 冻结输入、输出、金额口径和规则版本契约。
2. 建立只读数据聚合与数据完整性检查。
3. 实现确定性 Rule Engine。
4. 验证流动性、FIFO成本、双利润和风险计算。
5. 建立 Evidence Chain 和不可变建议版本机制。
6. 接入 AI 解释与建议表达层。
7. 整合 Settlement Intelligence 和日报页面。
8. 建立 Shadow Mode 效果评估和监控。
9. 设计可选的 Lark 只读提醒能力。
10. 完成安全、性能、审计和生产验收。

任何阶段都不得以自动执行作为验收条件。

## 8. 暂缓功能

以下能力不属于 Task 3：

- 审批流程。
- 修改决策。
- 删除决策。
- 自动执行。

这些能力需等待系统正式上线运行后，根据真实运营流程、角色权限和风险控制要求重新设计。现有 Shadow Mode 边界不得因未来规划而提前放宽。

## 决策结论

Task 3 将 Settlement Intelligence Engine V1 定义为“确定性规则计算 + AI建议解释 + 完整证据链”的只读决策支持系统。

本ADR作为 Task 3 开发前冻结文档。任何涉及自动执行、审批或可变历史记录的设计变更，都必须通过新的架构决策记录重新评审。
