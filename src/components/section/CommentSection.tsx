// 评论功能已下线（2026-09-08 PERF_TASK2 任务 2）：
// Twikoo / Giscus 动态导入与渲染分支已移除，相关 chunk 不再产出。
// 组件保留为空壳（渲染恒为 null），调用方（post/[post].tsx、ShopPostPage.tsx）无需改动；
// blog.config.ts 的 ENABLE_COMMENT / COMMENT_CONFIG 字段仅为类型兼容保留，
// 即使误开 ENABLE_COMMENT=true 也只会安静渲染 null，不会报错、不会请求评论服务。
const CommentSection = (): null => null

export default CommentSection
