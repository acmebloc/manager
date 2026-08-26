export const RECURRENCE_INTERVALS = [1, 2, 3, 4]
const MAX_RECURRENCE_WEEKS = 52
const MS_PER_DAY = 24 * 60 * 60 * 1000

export function isValidRecurrenceInterval(v) {
  return RECURRENCE_INTERVALS.includes(v)
}

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * MS_PER_DAY)
}

// 반복 종료일은 항상 첫 회차 시작일로부터 52주(약 1년) 안으로 clamp한다 —
// 데이터 폭주 방지용 안전장치. 주기가 다르면 52주 안에 들어가는 회차 수도
// 다르다(매주=최대52회, 2주=최대26회, 3주=최대17회, 4주=최대13회) — "회수"가
// 아니라 "52주"라는 시간으로 상한을 거는 이유.
export function clampRecurrenceEndAt(startAt, requestedEndAt) {
  const cap = addDays(startAt, MAX_RECURRENCE_WEEKS * 7)
  if (!requestedEndAt) return cap
  const requested = new Date(requestedEndAt)
  return requested < cap ? requested : cap
}

// 반복 규칙이 없으면 원본 그대로 회차 1개짜리 배열로 돌려준다(호출부가 반복/
// 비반복을 따로 분기하지 않아도 되게). 있으면 startAt을
// intervalWeeks*7일씩 밀며 recurrenceEndAt까지 가상 회차를 만들어 낸다 —
// 저장되는 건 규칙뿐이고 회차 자체는 매 조회마다 계산된다. 회차 하나가
// 개별적으로 수정/삭제(override)됐으면 그 회차만 override 값을 쓰거나
// (deleted면) 아예 뺀다.
export function expandOccurrences(schedule) {
  if (!schedule.recurrenceIntervalWeeks || !schedule.recurrenceEndAt) {
    return [{ ...schedule, occurrenceIndex: 0, isRecurring: false, hasOverride: false }]
  }

  const overridesByIndex = new Map((schedule.overrides || []).map((o) => [o.occurrenceIndex, o]))
  const stepDays = schedule.recurrenceIntervalWeeks * 7
  const endAt = new Date(schedule.recurrenceEndAt)
  const items = []

  // "전체 반복 일정" 수정 폼이 시리즈(root) 원본값으로 다시 채워질 수 있게
  // seriesTitle/seriesStartAt/seriesEndAt으로 따로 들고 간다 — 아래에서
  // title/startAt/endAt 자체는 회차별 값으로 덮어쓰기 때문.
  const base = { ...schedule, seriesTitle: schedule.title, seriesStartAt: schedule.startAt, seriesEndAt: schedule.endAt }

  // 최대 52주 규칙 + 최소 1주 간격이므로 회차는 아무리 많아도 52개를 넘지
  // 않는다 — 60은 그보다 넉넉한 안전판(clamp 전 상태로 잘못 저장된 값이
  // 있어도 무한 루프로 안 새게).
  for (let index = 0; index < 60; index += 1) {
    const occStart = addDays(schedule.startAt, index * stepDays)
    if (occStart > endAt) break

    const override = overridesByIndex.get(index)
    if (override?.deleted) continue

    items.push(
      override
        ? {
            ...base,
            id: `${schedule.id}:${index}`,
            scheduleId: schedule.id,
            occurrenceIndex: index,
            isRecurring: true,
            hasOverride: true,
            title: override.title,
            startAt: override.startAt,
            endAt: override.endAt,
          }
        : {
            ...base,
            id: `${schedule.id}:${index}`,
            scheduleId: schedule.id,
            occurrenceIndex: index,
            isRecurring: true,
            hasOverride: false,
            startAt: occStart,
            endAt: schedule.endAt ? addDays(schedule.endAt, index * stepDays) : null,
          },
    )
  }
  return items
}
