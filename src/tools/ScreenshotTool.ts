import { z } from 'zod'
import { Tool } from './index.js'

export const ScreenshotTool: Tool = {
  name: 'Screenshot',
  description: 'Capture a screenshot of a webpage. Returns the screenshot as a base64-encoded PNG or an error with install instructions.',
  parameters: z.object({
    url: z.string().describe('The URL of the webpage to screenshot'),
    fullPage: z.boolean().optional().describe('Whether to capture the full page or just the viewport (default: false)')
  }),
  async execute(args) {
    const url = args.url
    const fullPage = args.fullPage ?? false

    let puppeteer: any
    let playwright: any

    try {
      const puppeteerMod = await import('puppeteer')
      puppeteer = puppeteerMod.default || puppeteerMod
    } catch {
      // puppeteer not available
    }

    if (!puppeteer) {
      try {
        const playwrightMod = await import('playwright')
        playwright = playwrightMod.chromium || playwrightMod.firefox || playwrightMod.webkit
      } catch {
        // playwright not available
      }
    }

    if (!puppeteer && !playwright) {
      return `Error: No browser automation library found. Install one of the following:\n` +
        `  bun add puppeteer\n` +
        `  bun add playwright\n` +
        `Then rerun the screenshot command.`
    }

    try {
      if (puppeteer) {
        const browser = await puppeteer.launch({ headless: true })
        const page = await browser.newPage()
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

        const screenshotOptions: any = {
          type: 'png',
          encoding: 'base64'
        }
        if (fullPage) {
          screenshotOptions.fullPage = true
        }

        const base64 = await page.screenshot(screenshotOptions)
        await browser.close()
        return `data:image/png;base64,${base64}`
      } else if (playwright) {
        const browser = await playwright.launch({ headless: true })
        const page = await browser.newPage()
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

        const screenshotOptions: any = {
          type: 'png'
        }
        if (fullPage) {
          screenshotOptions.fullPage = true
        }

        const buffer = await page.screenshot(screenshotOptions)
        await browser.close()
        const base64 = Buffer.from(buffer).toString('base64')
        return `data:image/png;base64,${base64}`
      }
    } catch (err: any) {
      return `Error: ${err.message}`
    }

    return 'Error: Unknown screenshot failure'
  }
}
