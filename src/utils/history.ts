import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, unlinkSync, rmdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import { homedir } from 'os'

const HISTORY_DIR = join(homedir(), '.illuminati-code', 'history')

function ensureHistoryDir(): void {
  mkdirSync(HISTORY_DIR, { recursive: true })
}

function sanitizeFilePath(filePath: string): string {
  const resolved = filePath.startsWith('/') ? filePath : join(process.cwd(), filePath)
  return resolved.replace(/\//g, '_').replace(/\\/g, '_')
}

function getHistoryDirForFile(filePath: string): string {
  const sanitized = sanitizeFilePath(filePath)
  const dir = join(HISTORY_DIR, sanitized)
  mkdirSync(dir, { recursive: true })
  return dir
}

export interface Snapshot {
  timestamp: number
  content: string
  path: string
}

export function saveSnapshot(filePath: string, content: string): Snapshot {
  ensureHistoryDir()
  const dir = getHistoryDirForFile(filePath)
  const timestamp = Date.now()
  const snapshot: Snapshot = { timestamp, content, path: filePath }
  const fileName = `${timestamp}.json`
  const fileFullPath = join(dir, fileName)
  writeFileSync(fileFullPath, JSON.stringify(snapshot, null, 2), 'utf-8')
  return snapshot
}

export function undoLast(filePath: string): Snapshot | null {
  const dir = getHistoryDirForFile(filePath)
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ name: f, time: parseInt(f.replace('.json', ''), 10) }))
    .filter(f => !isNaN(f.time))
    .sort((a, b) => b.time - a.time)

  if (files.length === 0) return null

  const latest = files[0]
  const snapshotPath = join(dir, latest.name)
  let snapshot: Snapshot
  try {
    const data = readFileSync(snapshotPath, 'utf-8')
    snapshot = JSON.parse(data)
  } catch (err: any) {
    // Corrupted snapshot - clean up and return null
    try { unlinkSync(snapshotPath) } catch {}
    return null
  }

  writeFileSync(filePath, snapshot.content, 'utf-8')
  unlinkSync(snapshotPath)
  return snapshot
}

export function getHistory(filePath: string): Snapshot[] {
  const dir = getHistoryDirForFile(filePath)
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ name: f, time: parseInt(f.replace('.json', ''), 10) }))
    .filter(f => !isNaN(f.time))
    .sort((a, b) => a.time - b.time)

  const snapshots: Snapshot[] = []
  for (const f of files) {
    try {
      const data = readFileSync(join(dir, f.name), 'utf-8')
      snapshots.push(JSON.parse(data))
    } catch {
      // skip corrupted
    }
  }
  return snapshots
}

export function clearHistory(filePath: string): number {
  const dir = getHistoryDirForFile(filePath)
  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  let count = 0
  for (const f of files) {
    try {
      unlinkSync(join(dir, f))
      count++
    } catch {
      // skip
    }
  }
  try {
    rmdirSync(dir)
  } catch {
    // dir not empty or other issue
  }
  return count
}
