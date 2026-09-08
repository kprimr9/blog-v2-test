import { ApiColor } from '@/src/types/notion'
interface BlogConfig {
  NOTION_PAGE_ID: string
  NOTION_SITE_NAME: string
  NEXT_REVALIDATE_SECONDS: number
  // 某时间前，强制更新时间为创建时间
  FORCE_UPDATE_TIME: number
  // Post 默认图片
  DEFAULT_POST_COVER: string
  // 进度条颜色
  PROGRESS_BAR_COLOR: string
  // 主页/分类页显示的 Posts 数量（建议 medium, small, more 数量为偶数）
  HOME_POSTS_COUNT: {
    [type: string]: number
  }
  // 归档页每页显示的数量
  ARCHIVE_PER_COUNT: number
  /**
   * 构建时预渲染的文章路径数。0 = 不预渲染 /post/*（推荐 SaaS：靠 fallback + 保存后刷新）。
   * 可设为 20 等以预热热门页，但不建议全量。
   */
  STATIC_POST_PATHS_MAX?: number
  // public 下图标目录
  ICON_PATH: string
  // 默认特殊页面对应的 slug
  DEFAULT_SPECIAL_PAGES: {
    [type: string]: string
  }
  // 网站开始日期
  SITE_START_DATE: string
  // 备案号
  SITE_BEIAN?: {
    ICP?: string
    GONGAN?: string
  }
  // 是否显示不支持的 block
  SHOW_UNSUPPORTED_BLOCK?: boolean
  // 引用卡片严格模式
  STRICT_QUOTE_CARD?: boolean
  // 旧博客信息
  PAST_BLOG_INFO?: {
    // 旧博客地址
    URL: string
    // 旧博客文章地址
    POST_URL: string
    // 旧博客停运日期
    STOP_DATE: string
  }
  // 转载提示
  REPOST_MESSAGE?:[
    {
      // 当匹配到此链接显示转载提示 Icon
      URL: string
      // 转载提示网站名
      NAME?: string
      // 转载提示 Icon
      ICON?: string
      // 转载提示颜色
      COLOR?: ApiColor
    }
  ]
  // 启用评论
  ENABLE_COMMENT?: boolean
  // 评论配置
  COMMENT_CONFIG?: {
    // 评论服务商配置
    TWIKOO?: {
      // Twikoo
      ENVID: string
    }
    GISCUS?: {
      // Giscus
      REPO: `${string}/${string}`
      REPOID: string
      CATEGORY: string
      CATEGORYID: string
    }
  }
  // 是否开启 Draft Dialog
  ENABLE_DRAFT_DIALOG?: boolean
  /** Gallery 主题侧栏「登录」按钮跳转地址 */
  GALLERY_LOGIN_URL?: string
  /** Album / 使用说明 → 关于页 */
  GALLERY_GUIDE_PATH?: string
  /** Album / Models → 更多内容 */
  GALLERY_MORE_PATH?: string
}

const CONFIG: BlogConfig = {
  // 🟢 核心改造：彻底移除硬编码的旧 ID。
  // 现在它会优先读取 NOTION_PAGE_ID，如果没有，就读 NOTION_DATABASE_ID。
  // 只要你在 Vercel 填了其中任意一个，前端和后台就能完美共享同一个数据库！
  NOTION_PAGE_ID: process.env.NOTION_PAGE_ID || process.env.NOTION_DATABASE_ID || '',
  
  NOTION_SITE_NAME: 'anzifan',
  // ISR 自然过期兜底 TTL（默认 21600 = 6h）。后台保存/发布走 on-demand revalidate 即时更新，
  // 此值仅决定无人访问变更时的最长陈旧窗口；生产 env 显式设置时以 env 为准。
  NEXT_REVALIDATE_SECONDS: Number(process.env.NEXT_REVALIDATE_SECONDS) || 21600,
  FORCE_UPDATE_TIME: 1620000000000,
  DEFAULT_POST_COVER:
    'https://img.x1file.top/disk_r/2026/05/31/6a1bf12f468b6.jpg',
  PROGRESS_BAR_COLOR: '#e5e5e590',
  HOME_POSTS_COUNT: {
    LARGE: 1,
    MEDIUM: 2,
    SMALL: 6,
    MORE: 6,
  },
  ARCHIVE_PER_COUNT: 10,
  STATIC_POST_PATHS_MAX: 0,
  ICON_PATH: '/icons',
  DEFAULT_SPECIAL_PAGES: {
    TAG: 'tag',
    CATEGORY: 'category',
    ARCHIVE: 'archive',
    FREINDS: 'friends',
    ABOUT: 'about',
    /** 下载说明（独立 pages/download.tsx，勿与 [page].tsx 重复生成） */
    DOWNLOAD: 'download',
  },
  SITE_START_DATE: '2020',
  SITE_BEIAN: {
    ICP: '苏ICP备 2020060340 号',
    GONGAN: '苏公网安备 32011202000528 号',
  },
  SHOW_UNSUPPORTED_BLOCK: false,
  STRICT_QUOTE_CARD: true,
  PAST_BLOG_INFO: {
    URL: 'https://anzifan-old.vercel.app',
    POST_URL: 'https://anzifan-old.vercel.app/post',
    STOP_DATE: '2022-05-07',
  },
  REPOST_MESSAGE:[
    {
      URL: 'sspai.com',
      NAME: '少数派',
      ICON: '/static/sspai.svg',
      COLOR: 'red',
    },
  ],
  ENABLE_COMMENT: false,
  COMMENT_CONFIG: {
    GISCUS: {
      REPO: 'MannyCooper/giscus-discussions',
      REPOID: 'R_kgDOGtIyjw',
      CATEGORY: 'Comments',
      CATEGORYID: 'DIC_kwDOGtIyj84CAxTy',
    },
    TWIKOO: {
      ENVID: 'twikoo-7gjtx7whfd732c11',
    },
  },
  ENABLE_DRAFT_DIALOG: true,
  // Gallery 主题登录按钮链接（可自行修改）
  GALLERY_LOGIN_URL: 'https://store.proplus.onl/buy',
  GALLERY_GUIDE_PATH: '/about',
  GALLERY_MORE_PATH: '/friends',
}

export default CONFIG
