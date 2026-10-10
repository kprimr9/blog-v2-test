import type { AppProps, NextWebVitalsMetric } from 'next/app'
import '../styles/globals.css'
/* 必须在 Tailwind 之后加载，否则 utilities 会覆盖 Gallery 正文块样式 */
import '../styles/gallery-prose.css'
import '../styles/gallery-grid.css'
import '../styles/gallery-category.css'
import '../styles/tweet-theme.css'

import CONFIG from '@/blog.config'
import BlogLayout from '@/src/components/layout/BlogLayout'
import { Analytics } from '@vercel/analytics/react'
import AOS from 'aos'
import 'aos/dist/aos.css'
import { ThemeProvider } from 'next-themes'
import Head from 'next/head'
import { event, GoogleAnalytics } from 'nextjs-google-analytics'
import NextNprogress from 'nextjs-progressbar'
import Script from 'next/script' // 1. 引入 Next.js 脚本组件
import { useEffect } from 'react'
import {
  AdminFaviconLinks,
  GalleryFaviconLinks,
} from '@/src/themes/gallery/GalleryFaviconLinks'
import {
  ActiveThemeProvider,
  useActiveTheme,
} from '@/src/components/theme/ActiveThemeProvider'
import { LightSeoMeta } from '@/src/components/seo/LightSeoMeta'
import { isTweetDarkTheme, isTweetLightTheme, isTweetTheme, isTweetThemeVariantLocked } from '@/src/themes/tweet/tweetTheme'
import { PostNavStallProvider } from '@/src/components/navigation/PostNavStallGuard'
import { ImageHostAssetBridge } from '@/src/components/media/ImageHostAssetBridge'
import { PvReporter } from '@/src/components/layout/PvReporter'
import ContentProtectGuard from '@/src/components/protection/ContentProtectGuard'
import { TweetLoadingProgress } from '@/src/themes/tweet/TweetLoadingProgress'
import type { PageSeoFlat } from '@/src/lib/seo/lightSeo'
import { NextPageWithLayout } from '../types/blog'

const CHATWOOT_ENABLED = false

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout
}

function BlogAppShell({ Component, pageProps, router }: AppPropsWithLayout) {
  const staticTheme = (pageProps as { activeTheme?: string })?.activeTheme
  const liveTheme = useActiveTheme()
  const activeTheme = liveTheme || staticTheme
  const isAdminRoute =
    router.pathname === '/admin' || router.pathname.startsWith('/admin/')
  const getLayout =
    Component.getLayout ?? ((page) => <BlogLayout>{page}</BlogLayout>)

  const effectivePageProps = {
    ...pageProps,
    activeTheme,
  }

  useEffect(() => {
    AOS.init({
      easing: 'ease-out-cubic',
      once: true,
      offset: 50,
      duration: 500,
    })
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (activeTheme === 'gallery' && !isAdminRoute) {
      root.classList.add('gallery-theme')
      root.classList.remove('tweet-theme')
      root.classList.remove('tweet-theme--light')
      root.classList.remove('tweet-theme--dark')
    } else if (isTweetTheme(activeTheme) && !isAdminRoute) {
      root.classList.add('tweet-theme')
      root.classList.remove('gallery-theme')
      root.classList.remove('tweet-theme--light')
      root.classList.remove('tweet-theme--dark')
      if (isTweetLightTheme(activeTheme)) {
        root.classList.add('tweet-theme--light')
      } else if (isTweetDarkTheme(activeTheme)) {
        root.classList.add('tweet-theme--dark')
      }
    } else {
      root.classList.remove('gallery-theme')
      root.classList.remove('tweet-theme')
      root.classList.remove('tweet-theme--light')
      root.classList.remove('tweet-theme--dark')
    }
    return () => {
      root.classList.remove('gallery-theme')
      root.classList.remove('tweet-theme')
      root.classList.remove('tweet-theme--light')
      root.classList.remove('tweet-theme--dark')
    }
  }, [activeTheme, isAdminRoute])

  const tweetThemeLocked = isTweetThemeVariantLocked(activeTheme)
    ? isTweetLightTheme(activeTheme)
      ? 'light'
      : 'dark'
    : undefined
  const tweetDarkDefault =
    activeTheme === 'tweet' || isTweetDarkTheme(activeTheme)

  const stallGuardEnabled = !isAdminRoute

  return (
    <>
      {/* 2. 替换 Jivo 为 Chatwoot 增强版逻辑 */}
      {CHATWOOT_ENABLED && !isAdminRoute ? (
        <Script id="chatwoot-setup" strategy="afterInteractive">
          {`
          (function(d,t) {
            var BASE_URL = "https://chat.pro-pl.us";
            var g = d.createElement(t), s = d.getElementsByTagName(t)[0];
            g.src = BASE_URL + "/packs/js/sdk.js";
            g.defer = true;
            g.async = true;
            s.parentNode.insertBefore(g, s);

            window.chatwootSettings = {
              position: 'right',
              type: 'standard',
              launcherTitle: '',
              darkMode: 'light',
              // 监听消息：实现丝滑提醒逻辑
              onMessage: function(message) {
                if (message.message_type === 1) {
                  // A. 播放声音
                  var audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3");
                  audio.play().catch(function(e) { console.log("等待交互后开启声音") });

                  // B. 手机震动
                  if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);

                  // C. 窗口抖动
                  var container = d.getElementById('chatwoot-widget-container');
                  if (container) {
                    container.style.transition = "transform 0.1s";
                    var count = 0;
                    var interval = setInterval(function() {
                      container.style.transform = (count % 2) ? "translateX(-15px)" : "translateX(15px)";
                      if (++count > 12) {
                        clearInterval(interval);
                        container.style.transform = "translateX(0)";
                      }
                    }, 80);
                  }

                  // D. 标题闪烁
                  var oldTitle = d.title;
                  var blink = true;
                  var timer = setInterval(function() {
                    d.title = blink ? "【新回复】" + oldTitle : oldTitle;
                    blink = !blink;
                  }, 1000);
                  d.addEventListener('click', function() { clearInterval(timer); d.title = oldTitle; }, { once: true });
                }
              }
            };

            function patchChatwootLauncher() {
              var textEl = d.getElementById('woot-widget--expanded__text');
              if (textEl) textEl.textContent = '';
              var bubble = d.querySelector('.woot-widget-bubble');
              if (bubble) {
                bubble.setAttribute('aria-label', '在线客服');
                bubble.setAttribute('title', '在线客服');
              }
            }
            function watchChatwootLauncherText() {
              var textEl = d.getElementById('woot-widget--expanded__text');
              if (!textEl || textEl.__cwPatched) return;
              textEl.__cwPatched = true;
              patchChatwootLauncher();
              new MutationObserver(patchChatwootLauncher).observe(textEl, {
                characterData: true,
                childList: true,
                subtree: true
              });
            }
            function forceChatwootLightPanel() {
              if (window.$chatwoot && window.$chatwoot.setColorScheme) {
                window.$chatwoot.setColorScheme('light');
              }
            }
            window.addEventListener('chatwoot:ready', function() {
              patchChatwootLauncher();
              watchChatwootLauncherText();
              forceChatwootLightPanel();
            });

            g.onload = function() {
              window.chatwootSDK.run({
                websiteToken: 'SGwpXTTn9T7jhVsvudTEy1tV',
                baseUrl: BASE_URL
              });
              [400, 1200, 2500, 5000].forEach(function(ms) {
                setTimeout(function() {
                  patchChatwootLauncher();
                  watchChatwootLauncherText();
                  forceChatwootLightPanel();
                }, ms);
              });
            }
          })(document,"script");
        `}
        </Script>
      ) : null}

     <ThemeProvider
      attribute="class"
      forcedTheme={tweetThemeLocked}
      defaultTheme={tweetDarkDefault ? 'dark' : undefined}
      enableSystem={!tweetThemeLocked}
    >
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        {isAdminRoute ? (
          <AdminFaviconLinks />
        ) : (
          <GalleryFaviconLinks activeTheme={activeTheme} />
        )}
      </Head>
      <ImageHostAssetBridge />
      <LightSeoMeta
        seo={(pageProps as { seo?: PageSeoFlat })?.seo}
        siteName={pageProps?.siteTitle?.text}
        pageSubtitle={pageProps?.siteSubtitle?.text}
        isAdmin={isAdminRoute}
        sitePlan={(pageProps as { sitePlan?: 'free' | 'pro' })?.sitePlan}
      />
      <NextNprogress
        color={CONFIG.PROGRESS_BAR_COLOR}
        options={{ showSpinner: false }}
      />
      {isTweetTheme(activeTheme) && !isAdminRoute ? <TweetLoadingProgress /> : null}
      <GoogleAnalytics trackPageViews />
      <PostNavStallProvider enabled={stallGuardEnabled}>
        {getLayout(<Component {...effectivePageProps} />)}
      </PostNavStallProvider>
      {/* P14:内容保护(全主题);仅前台挂载,/admin 不受影响 */}
      {!isAdminRoute ? <ContentProtectGuard /> : null}
      <PvReporter />
      <Analytics />
    </ThemeProvider>
    </>
  )
}

export function reportWebVitals(metric: NextWebVitalsMetric) {
  const { id, name, label, value } = metric
  event(name, {
    category: label === 'web-vital' ? 'Web Vitals' : 'Next.js custom metric',
    value: Math.round(name === 'CLS' ? value * 1000 : value),
    label: id,
    nonInteraction: true,
  })
}

function BlogApp(props: AppPropsWithLayout) {
  const staticTheme = (props.pageProps as { activeTheme?: string })?.activeTheme
  const isAdminRoute =
    props.router.pathname === '/admin' ||
    props.router.pathname.startsWith('/admin/')

  return (
    <ActiveThemeProvider
      initialTheme={staticTheme}
      isAdminRoute={isAdminRoute}
    >
      <BlogAppShell {...props} />
    </ActiveThemeProvider>
  )
}

export default BlogApp
