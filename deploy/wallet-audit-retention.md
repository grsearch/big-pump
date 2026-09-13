# 钱包审计体积与归档清理

## 执行范围：一次性维护，不是每次部署步骤

普通代码更新不得自动运行本文的历史导出、dry-run 或 apply，也不得启动服务器遗留的 prune-chain 后台链。先遵循 [部署入口](README.md)，仅在新的维护任务明确要求清理时使用下文。

2026-09-13 本轮历史清理已由用户提供的服务器日志确认结束：17:07:49 出现 `CHAIN COMPLETE W1=0`；W2 删除 132,922 行、W3 删除 44,500 行，均 `EXIT=0`。W1 成功退出，但这里未记录其最终删除数量，不推算总删除量。此记录只适用于该服务器本轮任务，不表示其他数据库也已清理。

后续更新跳过本轮归档的重新核对与清理。数据库文件未缩小不是重跑理由。将来的清理需单独确定新的范围和已验证归档；中断任务先核查原进程与日志，不能因聊天超时另起一份。脚本本身仍允许显式幂等重跑，以支持真正中断后的恢复。

本次不自动删除任何服务器数据，也不执行 VACUUM。部署 collector 后，新钱包审计采用紧凑摘要，仅关键状态/收益/覆盖发生变化时写入；updatedAt 和年龄小数变化不触发审计。完整当前钱包记录、原始 trade / wallet-fee、持仓与订单仍留在 records。旧钱包审计保持原样，待归档验证。

## 先验证新版导出

`scripts/export_sharded.py` 不再要求数据库四倍空间。开始前按 SQLite page_count × page_size 预留一份快照，加 512MB 保底空间；备份及流式输出期间持续检查空间，不足即失败并清理。归档打包前删除已关闭的临时快照，回收空间，再检查打包空间。

先小窗口导出、验证并上传 COS，再恢复每日任务。历史钱包审计需按实际时间范围完整归档，不能只导出近一天后删除更早记录。

## 只清理已归档的 wallet 审计

先预览，参数替换为实际已上传归档：

```bash
cd /home/ubuntu/big-pump
.export-venv/bin/python scripts/prune_wallet_audit.py --db data/pump.db --archive exports/daily/ARCHIVE.tar.gz
```

核对 matched / alreadyAbsent 后，使用同一 COS 凭证环境和正确对象 key 执行：

```bash
.export-venv/bin/python scripts/prune_wallet_audit.py --db data/pump.db --archive exports/daily/ARCHIVE.tar.gz --cos-key big-pump/daily/ARCHIVE.tar.gz --apply
```

执行前验证归档内部哈希与审计数量、COS 全对象与本地文件 SHA-256，并逐行比较数据库 seq、at、kind、ca 和脱敏内容。只有完全匹配的 wallet 审计进入清理列表，每次事务最多 100 行。其他审计、records、交易与成本依据均不删除。任何不匹配先修正，不绕过校验。

旧的非一致快照归档也可以逐行核对；只允许清理它确实包含且匹配的行，不能按一个宽泛日期范围删除。未归档的行不会清理。幂等重跑时已删除的行计为 alreadyAbsent。

删除后数据库文件通常不缩小，但 SQLite 空闲页可复用。需要物理缩盘时另选维护窗口和空间方案；本流程不停止交易、不全库 VACUUM。

## 恢复调度

`deploy/install-export.sh` 已指向仓库分片脚本，且取消失败后自动重启循环，保留北京时间 06:00 和 Persistent 调度。验证通过后由 OpenClaw 检查现有服务的 Python、COS 环境文件、DATA_DIR 与超时设置；保持这些部署参数，仅切换脚本入口并设置 Restart=no，再恢复原定时器。不要未经验证直接启用，以免 Persistent 补跑。

上传失败时已生成本地归档保留，重试应上传同一个文件，不重复生成同名归档。锁和临时文件遇 SIGKILL/断电仍需确认进程不存在后定向清理。

## 判断清理进度

新版清理脚本向 stderr 每约 10 秒输出阶段进度（有读取/处理进展时），最后向 stdout 输出结果。后台启动需将 stdout 与 stderr 一起重定向。阶段为 archive_hash、cos_download_hash、local_archive_hash、compare_rows、delete_rows、complete。只有 delete_rows 的 deleted 才表示已提交删除，不要把 matched 当作已删除。网络读阻塞时日志不一定每 10 秒出现，需同时看进程 CPU / I/O。

apply 会重新核对归档和数据库，不复用前一次 dry-run，因此大归档可能再次花费几十分钟。旧进程不会因更新脚本文件获得进度日志，不要为看日志重复启动。由 OpenClaw 检查现有进程 PID、运行时长、日志末尾、间隔十秒的 /proc/PID/io 变化和退出码。不要用一次全表 COUNT 再增加大库扫描压力，不要通过 db 文件是否变小判断完成。
