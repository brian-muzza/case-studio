// Navegador para capturas: sin las marcas de automatización (navigator.webdriver, "HeadlessChrome"),
// así los sitios con protección anti-bots o videos de Vimeo/YouTube se ven como para un visitante real.
import { chromium } from 'playwright';

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export async function launchBrowser() {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options = {}) => {
    const ctx = await newContext({ userAgent: options.isMobile ? undefined : DESKTOP_UA, ...options });
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
    return ctx;
  };
  return browser;
}
