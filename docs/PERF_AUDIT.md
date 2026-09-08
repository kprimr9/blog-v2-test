# v2-test 构建产物实测审计（Hermes 补测 2026-09-08）

> 目的：给 GLM 优化评估基线（GLM 沙箱无法读 .next 产物，本文件为实测补全）

## 实测数据
### 每页 chunk 数（build-manifest，Next 13 Pages Router）
| 页面 | chunks |
|---|---|
| / | 12 |
| /post/[post] | **21** |
| /archive/[page] | 14 |
| /category/[category] | 12 |
| /tag/[tag] | 12 |

### 大 chunk 清单（.next/static/chunks，按体积）
```
6612 KB  6de85de8.c235649b20cd0c33.js   ← 未出现在页面 manifest（疑似第三方大库/主题树）
4728 KB  83d4629a.b68c57f07556d948.js   ← 同上
4120 KB  563524a3.6ca7d29a85d7388e.js
2548 KB  be2cc83c.8a42887ef78e12af.js
2048 KB  0d2a15ad.8fa71fa13be3de08.js
1852 KB  7e4bc21f.ba886790aff01ef9.js
1564 KB  b6fadce0.96b9e00e32bf5663.js
1532 KB  a2f8a28d.3d6e566ce2a42755.js
1480 KB  1bc244d8.262b2ec11c19eb05.js
1264 KB  3230ce31.bc6d59461d1ace8e.js
```

### react-loadable-manifest（动态导入确认）
- `components/section/CommentSection.tsx` → `comments/GiscusComponent`（1 chunk）+ `comments/TwikooComponent`（2 chunks：144b04bd…+9183…）
- `components/section/CommentSection.tsx` → `react-player` 全家桶（DailyMotion/Facebook/FilePlayer/Kaltura/Mixcloud/Mux/SoundCloud/Streamable/Twitch/Vidyard/Vimeo/Wistia/YouTube 14 个玩家 chunk）
- `admin.js` → AdminDashboard（2 chunks，后台——留存不动）

### Vercel 402 真实计量（用户截图，352q0p）
- Fluid Active CPU 12h2m/4h（301%）
- Edge Requests 1.31M/1M（131%）
- Fluid Provisioned Memory 461.4/360 GB-Hrs（128%）
- ISR Writes 205K/200K（102%）
- Fast Data Transfer 4.28GB/100GB（5%——带宽无问题）
- Function Invocations 304K/1M（30%）

### 用户明确
- Twikoo/Giscus 评论**无实际使用**——允许移除（BLOG 无评论功能/未配置评论的站行为不变）
- 不影响 BLOG 正常功能/内容增量更新
