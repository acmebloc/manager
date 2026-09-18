#!/usr/bin/env node
//
// docs/ 규칙 검사기 — `npm run docs:check`.
//
// 왜 있는가: 문서마다 상태를 적는 방식이 달라서(상단 굵은 문장, 범위 표의 상태 열,
// [x] 체크리스트, (확정) 도장, 취소선…) 무엇이 최신인지 읽는 사람이 판단할 수
// 없었고, 실제로 여러 곳이 코드와 어긋난 채 몇 주씩 남아 있었다. 규칙 자체는
// docs/README.md에 적혀 있고, 이 스크립트는 그중 **기계로 확인할 수 있는 것만**
// 본다. 나머지는 사람이 지킨다.
//
// 종료 코드: 위반 0건이면 0, 있으면 1. 경고는 종료 코드를 바꾸지 않는다.

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOCS_DIR = path.join(ROOT, 'docs')

// docs/README.md는 규칙을 담은 색인이라 규칙의 적용 대상이 아니다.
const INDEX_FILE = 'README.md'

const STATUSES = ['초안', '기획확정', '구현중', '구현완료·미배포', '배포완료', '상시유지보수']

// 상태를 흐리게 만드는 표현들. 이 말이 본문 아무 데나 흩어져 있으면 "무엇이
// 아직인지"가 문서 전체를 읽어야만 드러난다. 그래서 '하지 않는 것' 절 안에서만
// 허용한다 — 거기 있는 건 목록이고, 구현되면 그 줄을 지우는 게 규칙이다.
const DEFERRAL_WORDS = ['미룸', '범위 밖', '남은 작업', '미확정', '나중에 추가']
const DEFERRAL_SECTION = /^##\s.*하지 않는 것/

// 상태 라벨의 단일 출처는 src/lib/taskFields.js다. 문서가 라벨을 직접 적으면
// 바뀔 때 같이 안 바뀐다 — 실제로 검수 기능에서 '등록/진행/검수' →
// '대기/진행중/검수중'으로 바뀌었는데 문서 세 곳이 옛 라벨로 남아 있었다.
const STALE_LABEL_PATTERNS = [/등록\s*\/\s*진행\s*\/\s*검수/, /등록·진행·검수/]

const problems = []
const warnings = []

function statusBlock(lines) {
  // H1 바로 뒤, 빈 줄을 건너뛴 자리에 세 줄이 연속으로 와야 한다.
  let i = lines.findIndex((l) => l.startsWith('# '))
  if (i === -1) return { error: '최상단 H1 제목이 없습니다' }
  i += 1
  while (i < lines.length && lines[i].trim() === '') i += 1

  const want = ['> **상태**: ', '> **최종 확인**: ', '> **미진행**: ']
  const got = lines.slice(i, i + 3)
  for (let k = 0; k < want.length; k += 1) {
    if (!got[k]?.startsWith?.(want[k])) {
      return { error: `제목 바로 아래에 상태 블록 3줄이 필요합니다 (${k + 1}번째 줄이 '${want[k]}…'이 아님)` }
    }
  }
  return {
    status: got[0].slice(want[0].length).trim(),
    checked: got[1].slice(want[1].length).trim(),
    pending: got[2].slice(want[2].length).trim(),
  }
}

function commitExists(hash) {
  try {
    execFileSync('git', ['cat-file', '-e', `${hash}^{commit}`], { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function lastCommitDate(file) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: ROOT }).toString().trim()
    return out || null
  } catch {
    return null
  }
}

const files = readdirSync(DOCS_DIR)
  .filter((f) => f.endsWith('.md') && f !== INDEX_FILE)
  .sort()

for (const file of files) {
  const rel = path.join('docs', file)
  const text = readFileSync(path.join(DOCS_DIR, file), 'utf8')
  const lines = text.split('\n')
  const add = (msg) => problems.push(`${rel}: ${msg}`)

  // 1) 상태 블록
  const block = statusBlock(lines)
  if (block.error) {
    add(block.error)
  } else {
    if (!STATUSES.includes(block.status)) {
      add(`상태 '${block.status}'는 허용된 값이 아닙니다 (${STATUSES.join(' / ')})`)
    }
    // '2026-09-18 · `f9e82f5`'
    const m = block.checked.match(/^(\d{4}-\d{2}-\d{2})\s+·\s+`([0-9a-f]{7,40})`$/)
    if (!m) {
      add(`최종 확인 형식이 'YYYY-MM-DD · \`커밋해시\`'가 아닙니다: ${block.checked}`)
    } else {
      const [, date, hash] = m
      if (Number.isNaN(Date.parse(date))) add(`최종 확인 날짜를 읽을 수 없습니다: ${date}`)
      if (!commitExists(hash)) add(`최종 확인 커밋이 저장소에 없습니다: ${hash}`)
      const touched = lastCommitDate(rel)
      if (touched && touched > date) {
        warnings.push(`${rel}: 문서는 ${touched}에 고쳐졌는데 최종 확인은 ${date}입니다 — 상태 블록을 갱신하세요`)
      }
    }
  }

  // 2) 보류 표현은 '하지 않는 것' 절 안에서만
  let inDeferralSection = false
  lines.forEach((line, idx) => {
    if (line.startsWith('## ')) inDeferralSection = DEFERRAL_SECTION.test(line)
    if (inDeferralSection) return
    if (line.startsWith('> **미진행**: ')) return // 상태 블록 자신
    for (const word of DEFERRAL_WORDS) {
      if (line.includes(word)) {
        add(`${idx + 1}행: '${word}'은 '## 하지 않는 것' 절 안에서만 쓸 수 있습니다 — ${line.trim().slice(0, 60)}`)
      }
    }
  })

  // 3) 낡은 상태 라벨
  lines.forEach((line, idx) => {
    for (const pattern of STALE_LABEL_PATTERNS) {
      if (pattern.test(line)) {
        add(`${idx + 1}행: 옛 상태 라벨입니다 — 현재 라벨은 src/lib/taskFields.js의 TASK_STATUSES(대기/진행중/검수중/완료)`)
      }
    }
  })
}

for (const w of warnings) console.warn(`경고 ${w}`)
if (problems.length > 0) {
  console.error(`\n문서 규칙 위반 ${problems.length}건 (규칙: docs/README.md)\n`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`문서 ${files.length}개 규칙 통과${warnings.length > 0 ? ` (경고 ${warnings.length}건)` : ''}`)
