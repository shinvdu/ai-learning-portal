# F045 CSRF 与同源保护

| 项 | 值 |
|---|---|
| 阶段 | M4 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 认证安全 |
| 依赖 | F030 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

对所有变更请求实施同源与双提交 CSRF 校验，保持 CI/curl 行为。

## 行为与范围

- Origin 存在时校验 host 与 aip_csrf cookie + X-CSRF-Token。
- 常量时间比较并先校验长度。
- Origin 缺失时按 v1 行为放行（非浏览器客户端）。
- 提供 /auth/csrf 发放令牌；SPA 启动缺失时自动获取。

## 验收标准

- [ ] 浏览器 Origin 无 token 返回 403。
- [ ] 正确 token 成功。
- [ ] 跨站 Origin 返回 403。
- [ ] 无 Origin 的 curl 放行。

## 代码位置（计划）

- `apps/api/src/lib/csrf.ts`
- `apps/api/src/lib/origin.ts`
- `apps/api/src/middleware/csrf.ts`
- `apps/api/src/modules/auth/routes.ts`

## 备注

生产静态页由 Nginx 提供，所以需要 CSRF 发放端点。
