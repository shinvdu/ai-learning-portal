# F101 文档与 v2.0.0 发布

| 项 | 值 |
|---|---|
| 阶段 | M9 |
| 优先级 | P0 |
| 状态 | 已完成（以追踪表为准） |
| 完成日期 | 2026-11-28 |
| 模块 | 迁移发布 |
| 依赖 | F090, F091, F092, F082, F083 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

完成 v2 文档更新、切换与发布。

## 行为与范围

- 更新 README/README.en/ARCHITECTURE/API/DEPLOYMENT/DEMO_GUIDE/CHANGELOG。
- 明确 v1.2.0 离线版与 v2 容器版的区别。
- 合并 next 到 main，打 tag v2.0.0，发布 Release 与镜像。
- 保留回退步骤。

## 验收标准

- [ ] 文档命令逐条可执行。
- [ ] CI 在 main 全绿。
- [ ] tag 与 Release 可见。
- [ ] 旧 v1.2.0 检出仍可 npm start。

## 代码位置（计划）

- `README.md`
- `README.en.md`
- `docs/`
- `CHANGELOG.md`
- `.github/workflows/ci.yml`

## 备注

提交信息不含助手署名。
