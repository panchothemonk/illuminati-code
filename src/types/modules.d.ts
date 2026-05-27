// Type declarations for optional dependencies
declare module 'puppeteer' {
  const puppeteer: any
  export default puppeteer
}

declare module 'playwright' {
  export const chromium: any
  export const firefox: any
  export const webkit: any
}
