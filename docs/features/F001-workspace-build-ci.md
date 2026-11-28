# F001 工作区、构建与 CI 基线

| 项 | 值 |
|---|---|
| 阶段 | M0 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 基础 |
| 依赖 | — |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

建立 npm workspaces、TypeScript project references、ESLint/Prettier、Vitest/Playwright 骨架和 GitHub Actions 质量门禁，作为 v2 所有后续工作的基线。

## 行为与范围

- 根 package.json 为私有 workspace，统一 dev/build/typecheck/lint/test 脚本。
- apps/api、apps/web、packages/* 通过 workspace 解析，单一 lockfile。
- CI 在 next/main 上执行安装、类型检查、lint、构建；后续扩展测试与 e2e。
- Node 24 基线，.nvmrc 与 engines 对齐。

## 验收标准

- [ ] 干净检出后 npm ci && npm run typecheck && npm run lint && npm run build 全绿。
- [ ] 任意 workspace 可独立构建，依赖只来自根 lockfile。
- [ ] CI 在 next 分支成功运行。
- [ ] 不引入第三方 UI 库与 CDN 依赖。

## 代码位置（计划）

- `package.json`
- `tsconfig.base.json`
- `tsconfig.json`
- `eslint.config.js`
- `.github/workflows/ci.yml`

## 备注

不引入 pnpm；当前环境 npm 11 足够。
