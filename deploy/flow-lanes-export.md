# 最新成交与一致快照导出

更新代码后构建前端、重启 collector 和 dashboard。实盘参数不变。flow-scan 旧游标会自动升级，不删除已有成交或持仓。

验证新毕业币的 `latestCheckedAt` 在历史 `jobs` 非空时仍持续推进；`head` 应随着新成交前进。历史失败查看 `historyError`，最新扫描失败查看 `error`。多币轮转仍有间隔，不能仅凭服务正常推断全量覆盖。比较 `receivedAt-at`，并将新币和部署时已有币的补扫分开统计。

## 替换服务器自建分片导出入口

仓库不知道服务器自建 `exports/export_sharded.py` 的实现和定时任务位置，不能自动覆盖。让 OpenClaw 将现有任务入口指向仓库的 `scripts/export_sharded.py`，保留原 Python 环境、COS 环境变量和调度时间。

先执行小窗口、不上传的测试（时间戳替换成实际窗口）：

```bash
cd /home/ubuntu/big-pump
.export-venv/bin/python scripts/export_sharded.py --db data/pump.db --out exports/verified --start-ms START_MS --end-ms END_MS
```

每日使用同一入口加 `--upload`，不传时间默认导出最近一次北京时间 06:00 之前的 24 小时。

- 所有表与审计从同一 SQLite 只读备份读取。manifest 与 analysis 都有 `consistentSnapshot`、`snapshotAtMs` 和 `snapshotAuditMaxSeq`。
- 按小时 gzip 分片写审计，context/flow 数组逐行写入；不一次性加载完整 audit。上传校验也按块读取。
- 临时快照和中间文件在成功或普通异常时清理；归档完成后才发布最终文件。
- 开始前保守预留数据库及 WAL 大小的 4 倍加 512MB 空间，避免在无空间时启动。输出目录锁阻止本脚本重复并发导出；已有同名归档不覆盖。
- SIGKILL/断电无法运行清理：锁内记录 PID。必须先确认对应导出进程不存在，再由运维清理该输出目录内的遗留锁和 `flow-export-*` 临时目录，不能直接删除所有 /tmp。
- 按成交时间筛 flowTrades、按审计时间筛 audit，即使同一快照也不要求数量永远相等。应逐个签名解释差异。回测使用接收时间和余额核验时间，不能让后补数据提前可见。

切换导出入口不需要重启交易服务；本次扫描和 UI 更新需要重启/构建。不要为了导出停止采集或交易。
