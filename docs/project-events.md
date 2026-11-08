# 项目事件记录（18-1）

页面入口：项目时间线 → 事件记录。原有会议主线和三星重点概览保留在另一个视图。

事件按真实操作时间倒序排列，支持类型、操作成员、起止日期和游标分页。日期按北京时间解释。旧事件只转换展示格式，缺失的精确时间、操作人和可定位来源不会补造。私人待办、个人标记、个人标签和个人提醒不写入公开项目事件。

## 接口

- `GET /api/project-events`：可传 `kind`、`memberId`、`from`、`to`、`limit`、`cursor`；返回 `items`、`total`、`hasMore`、`nextCursor`、筛选类型及成员列表。默认每页 20 条，上限 100 条，也兼容 `offset`。
- `GET /api/project-events/source?id=事件ID`：在当前账号有权访问的项目内重新验证来源。删除的来源、跨项目对象或受角色限制的邀请返回 404；事件本身仍可查阅。
- 使用 `X-Project-Id` 指定项目。当前登录账号必须是项目成员。

## 接入新模块

业务验证与权限检查通过后，先判断是否真正改变记录；同状态保存直接返回。修改来源记录后调用服务端 `recordProjectEvent(workspace, actor, details)`，随后 `await save()`。

```js
recordProjectEvent(workspace, actor, {
  kind: '工作分配',
  action: 'assignment-updated',
  title: '调整了工作分配',
  detail: `${actor.name} · ${assignment.content}`,
  assignmentId: assignment.id,
  before,
  after
});
await save();
```

记录器统一补充项目 ID、ISO 时间、北京时间日期、操作人快照和摘要。优先关联具体文件、分工、日志或分析版本；不要以对象名称猜来源。后台完成记录使用任务 ID 构成 `dedupeKey`，防止重复完成通知。

需要防止创建请求重试时，把新接口加入 `transactionalRoutes`。客户端在同一次操作的重试中携带相同 `X-Operation-Id`，成功后的新操作生成新 ID。回执与业务记录、事件一起持久化；相同标识但不同请求内容返回 409。省略标识的创建请求被视为新的独立操作。

后台任务通过 `scheduleWorkspaceTask` 启动，只在提交成功后执行。任务在项目副本中处理外部网络结果，由 `save()` 把改动字段合并到当前项目并提交，避免覆盖其他成员同时保存的数据。不要在外部网络任务中直接修改全局数据库。

## 验证

`npm test` 包含无变化保存、无权限/无效操作、重复创建、持久化故障、后台保存与业务事务并发、三个转写供应商的并发轮询及人工修订保护。外部供应商回应用测试夹具模拟，不发出真实服务调用。
