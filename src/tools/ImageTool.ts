import { z } from 'zod'
import { Tool } from './index.js'

const KIMI_BASE_URL = 'https://api.kimi.com/coding'
const KIMI_CLAW_ID = '19e51d2c-47a2-8b88-8000-000027bae32f'
const KIMI_MODEL = 'kimi-k2.6'

export const ImageTool: Tool = {
  name: 'Image',
  description: 'Analyze an image file using the Kimi vision API. Returns a description or analysis of the image content.',
  parameters: z.object({
    imagePath: z.string().describe('Absolute or relative path to the image file'),
    prompt: z.string().optional().describe('Optional prompt to guide the analysis (default: "Describe this image in detail.")')
  }),
  async execute(args) {
    const { readFileSync, existsSync } = await import('fs')
    const { resolve } = await import('path')
    const fullPath = resolve(args.imagePath)

    if (!existsSync(fullPath)) {
      return `Error: File not found: ${fullPath}`
    }

    try {
      const buffer = readFileSync(fullPath)
      const base64 = buffer.toString('base64')
      const mimeType = getMimeType(fullPath)
      const prompt = args.prompt || 'Describe this image in detail.'

      const apiKey = process.env['KIMI_API_KEY'] || ''
      if (!apiKey) {
        return 'Error: KIMI_API_KEY not set. Cannot analyze image.'
      }

      const response = await fetch(`${KIMI_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'Desktop Kimi Claw Plugin',
          'X-Kimi-Claw-ID': KIMI_CLAW_ID
        },
        body: JSON.stringify({
          model: KIMI_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64}`
                  }
                }
              ]
            }
          ],
          max_tokens: 4096,
          temperature: 0.7
        })
      })

      if (!response.ok) {
        const errText = await response.text()
        return `Error: HTTP ${response.status}: ${errText}`
      }

      const data = await response.json() as any
      const content = data.choices?.[0]?.message?.content || ''
      return content || 'No analysis returned.'
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }
}

function getMimeType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml'
  }
  return map[ext] || 'image/png'
}
