# Sky 页评分数据增强 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用公开免费数据改善云海、晚霞、徒步和星空评分，同时保证辅助接口失败时页面仍可用。

**Architecture:** Open-Meteo 天气接口是强依赖，Air Quality 接口是弱依赖；网络层返回结构化数据，纯函数层完成天文与评分修正。所有新字段均为可选，旧数据结构仍能降级计算。

**Tech Stack:** 微信小程序、TypeScript、Open-Meteo Forecast/Air Quality API、Node.js 内置测试运行器

---

## Chunk 1: 数据结构与纯函数

### Task 1: 新增评分辅助函数

**Files:**
- Create: `miniprogram/pages/sky/utils/scoringEnhancements.ts`
- Create: `miniprogram/pages/sky/utils/scoringEnhancements.test.ts`

- [ ] 写失败测试：逆温/云底修正、气溶胶修正、月亮高度修正。
- [ ] 用 Node 内置测试运行器确认测试因模块不存在而失败。
- [ ] 实现无副作用辅助函数。
- [ ] 重新运行测试并确认通过。

### Task 2: 扩展 API 类型

**Files:**
- Modify: `miniprogram/pages/sky/types.ts`

- [ ] 增加小时垂直层、云底、阵风、体感温、空气质量以及组合结果类型。
- [ ] 运行 TypeScript 编译检查。

## Chunk 2: 接口与页面数据流

### Task 3: 扩展天气请求并新增空气质量请求

**Files:**
- Modify: `miniprogram/pages/sky/utils/api.ts`

- [ ] 写可测试的 URL 构造函数测试，覆盖地点海拔和新增字段。
- [ ] 确认测试失败。
- [ ] 天气 URL 加入新增字段与可选海拔。
- [ ] 新增空气质量弱依赖请求，并实现并行组合函数。
- [ ] 确认测试通过。

### Task 4: 页面传递地点海拔与组合数据

**Files:**
- Modify: `miniprogram/pages/sky/index.ts`

- [ ] `loadForecast` 使用组合请求。
- [ ] 将空气质量传给评分入口。
- [ ] 确保空气质量失败不进入页面错误状态。

## Chunk 3: 评分模型

### Task 5: 接入云海、晚霞、徒步与星空评分

**Files:**
- Modify: `miniprogram/pages/sky/utils/weatherModel.ts`
- Modify: `miniprogram/pages/sky/utils/astronomy.ts`

- [ ] 按日期对齐空气质量小时数据。
- [ ] 云海加入垂直温度、云底和阵风修正。
- [ ] 晚霞加入 AOD/PM2.5 修正及解释因子。
- [ ] 徒步用体感温和阵风修正。
- [ ] 星空逐小时使用月亮高度决定月光惩罚。
- [ ] 运行全部新增测试。

## Chunk 4: 验证

### Task 6: 完整验证

- [ ] 运行 TypeScript 编译检查。
- [ ] 检查编辑文件 lint。
- [ ] 检查 git diff，确认未覆盖无关改动。
- [ ] 记录已实现范围、降级行为和仍存在的数据上限。
