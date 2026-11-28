# F094 MinIO/S3 媒体

| 项 | 值 |
|---|---|
| 阶段 | M8 |
| 优先级 | P1 |
| 状态 | 未开始（以追踪表为准） |
| 完成日期 | — |
| 模块 | 基础设施 |
| 依赖 | F090, F061 |

> [功能追踪表](../FEATURE_TRACKER.xlsx) · [架构总文档](../ARCHITECTURE_V2.md)

## 目标

为未来课程视频上传提供对象存储适配，多实例共享媒体。

## 行为与范围

- 存储适配器 local/s3，环境变量选择。
- 管理端获取预签名上传/播放 URL。
- 本地开发可继续用 public/assets 占位视频。
- MinIO 通过 compose profile 启动。

## 验收标准

- [ ] s3 模式下视频 URL 可播放且支持 Range。
- [ ] 切换 local 不影响现有页面。
- [ ] 预签名 URL 有有效期。
- [ ] 密钥不进入前端。

## 代码位置（计划）

- `apps/api/src/modules/media/`
- `compose.yml`

## 备注

本期不做转码与 HLS。
