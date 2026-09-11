# 实时监控前置过滤

新入监控的 Stonk 币必须满足：`0 ≤ 链上毕业时间 − 链上 LaunchLab 初始化时间 ≤ 20 分钟`。

官方 createdAt 可能是索引时间，甚至晚于 graduatedAt。列表中的毕业币先保留候选，不用这个字段直接排除。最终必须解码受信 Stonk 配置下的初始化和迁移交易，CA、曲线池、计价币及平台配置一致才计算时长。创建时间查询失败则保留重试，不会把迁移 blockTime 同时当成创建时间。

WebSocket 同时接收初始化和标准迁移提示；初始化只缓存证据，不入监控。已有缓存时直接验证，否则用 Helius 按时间升序读取曲线池最早 10 个成功交易，查找真实初始化。未找到仍待核验。候选补扫每页的全部有效签名逐批保存处理，不再只看 3 笔就翻页。首次升级会清除旧 API 时间排除结果，并重试最近 24 小时的发现记录。

两个公开回归案例：Bob 创建至迁移 109 秒，DIVI 72 秒，均为创建之后另有标准 MigrateToCpswap 交易，不是仅凭 InitializeWithToken2022 即可认定毕业的新变体。公开链上交易精简数据保存在 tests/fixtures；初始化账户顺序依据 Raydium 官方 SDK：https://github.com/raydium-io/raydium-sdk-V2/blob/master/src/raydium/launchpad/instrument.ts 。

20 分钟是创建到毕业的时长，不是程序发现延迟，也不是最长观察 AGE。进入后的观察 AGE 仍从毕业起计时，最长 24 小时。

更新不追溯删除已有观察记录或改变已有持仓退出规则。历史 FDV ≥1M 聪明钱包研究不受实时入场过滤影响。
