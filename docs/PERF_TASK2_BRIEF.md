# v2-test 上线前优化——任务补充单（GLM 第二轮）

> 依据：Hermes 实测审计（docs/PERF_AUDIT.md）+ 用户拍板（Twikoo/Giscus 评论无需保留、不破坏 BLOG 功能/内容增量更新）
> 执行：GLM。硬约束：不 git / 不 SQL / 不动 admin.js 核心逻辑 / 不动 getBlogData 与 revalidateQueue 数据链路 / 不改内容同步机制 / 保守优先。

## 任务（按优先级）

### 任务 1：定位大 chunk（只读分析+结论）
`.next/static/chunks` 顶部 10 个 >1.2MB chunk（6de85de8…6612KB / 83d4629a…4728 / 563524a3…4120 / be2cc83c…2548 / 0d2a15ad…2048 / 7e4bc21f…1852 / b6fadce0…1564 / a2f8a28d…1532 / 1bc244d8…1480 / 3230ce31…1264）——**他们是什么库/模块？被哪些页面加载？**（方法：`grep -o` 模块注释/strings 特征如 katex/markdown/editor/video/theme/css 字符串；webpack-*.js chunk 映射；或对产物 `grep -c` 独有字符串后比对 src import 树）。结论输出：角色/大小/是否游客页加载/能否拆分或删除。
- 已知：TwikooComponent（144b04bd…→comments/Twikoo）+ GiscusComponent（1721.45f46e…→comments/Giscus）；ReactPlayer 各玩家 chunk（懒加载，先不动）；AdminDashboard（后台，不动）。

### 任务 2：移除评论引用（用户拍板：无需保留）
- `ENABLE_COMMENT=false`（blog.config.ts）已确认；`components/section/CommentSection.tsx` 仍动态 import Twikoo/Giscus。
- 实施：移除 CommentSection 内的 Twikoo/Giscus 动态导入与渲染分支（含 import 语句、状态、chunk 预载定义）；**保留** ENABLE_COMMENT 开关字段（不删配置项，避免后台/类型报错）+ 组件文件可保留但变为空壳/不渲染（说明选择）；确保**任何主题/页面在 ENABLE_COMMENT=false 时渲染行为完全不变**，true 时也不报错（或明确注释“不再支持”）。
- 收益：构建产物减小（Twikoo/Giscus chunk 消失）、潜在边缘/缓存载入量减少（虽然默认不加载，但消除死路径）。

### 任务 3：函数内存降配评估+实施（打 Fluid Provisioned Memory 128%）
- 现状：Vercel Hobby（Next 13 Pages Router）——`vercel.json` 目前仅 cron；**评估**：per-function memory 配置（`vercel.json` `functions` 或 route 级 `export const config`）在 Pages Router + Next 13 的可行性；**memory 1024→512 或 256 对 SSR 渲染（Notion 数据拉取+格式化 20 篇/S）的影响**（保守：512 起步，风险注明）。
- 实施（若评估安全）：为**前台页面函数**降配（错误页面/API 也可降）；后台/爬虫等重函数保持默认；产出改动+估算收益（Provisioned Memory 约 ×0.5）。
- **若不确定/风险高：只给方案不实施**（标注理由）。

### 任务 4：评估（只读，出方案不入码）
- **ISR Writes 102%**：当前 revalidate 全站路径树（文章+归档+分类+标签+自定义页）——**局部失效方案**（仅受影响路径），评估实现方式（改动面/对内容更新时效影响/风险）——**只出方案**，等 Hermes 转用户拍板后再实施。
- **CPU 12h/4h**：Notion 拉取频率/缓存命中率/ISR 生成成本——简析主要来源+建议（不实施）。

## 输出
1. 任务 1 结论（表：chunk/角色/游客加载?/处置）
2. 任务 2 diff 摘要（哪些行删了/组件状态化/ENABLE_COMMENT 行为等价证明）
3. 任务 3 结论+实施 diff（若做）
4. 任务 4 方案（ISR 局部失效+CPU 建议）
5. 自查：tsc 新错 0 / 受影响文件 eslint / 中文小结（git 可见清单）
