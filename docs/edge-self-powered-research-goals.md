# 边缘计算自供电设备 · 研究目标清单

面向 **edge computing self-powered devices**（环境取电 + 占空比 MCU/传感 + 可选射频）。  
每条目标有可观测量与检查工具；与 WaveWorld 已挂通路对齐。

| # | 研究目标 | Observable（可观测量） | Tool / command |
|---|----------|------------------------|----------------|
| R1 | 微功率环境取电候选不只有电厂级发电机 | `sensorsForSelfPower` / harvest+prefer-transducer 的 mechanical top-K 中含换能器尺度，且不全是 plant | `npx vitest run src/lib/applications.test.ts -t 'self-power\|harvest'` |
| R2 | 自供电可行性可算：采集功率能否盖住节点平均负载 | `computeNodeEnergyBudget`：P_avg 有限；P_harvest ≥ P_avg ⇒ net≤0 且寿命 ∞；不足时寿命有限或 requiredCapacity>0 | `npx vitest run src/lib/nodeEnergyBudget.test.ts` |
| R3 | 研究通路可发现：取电 → 账本 → RF/供能 | nav 含 sensing / node-budget / smith；methodsForSimPath 与页内 next-step 互链 | `npx vitest run src/lib/pathway-links.test.ts` |
| R4 | 端到端 persona：边缘节点选型不靠猜路由 | journey 驱动真实 API：self-power harvest 候选 + budget cover + Γ/Smith ok | `npx vitest run src/lib/user-journey-ulp-sensor.test.ts` |

## 推荐用户路径

1. **`/sensing`** — 意图「取能」或自供电序：环境能 → 电，优先换能器/俘能尺度  
2. **`/node-budget`** — 睡眠/唤醒电流 + 采集功率 → 是否自供电、寿命或所需 mAh  
3. **`/smith`** — 无线上报时阻抗失配是否再吃功率  
4. **`/matrix` / `/paths`** — 供能/转换路径对照  

## Pass/fail

- **Pass**：命令 exit 0，且日志中对应 observable 成立。  
- **Fail**：断言失败 → 修 ranking / budget / 接线，再跑。
