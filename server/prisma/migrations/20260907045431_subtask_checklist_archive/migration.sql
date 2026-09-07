-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "parentTaskId" TEXT;

-- DataMigration: 기존 TaskLink(type='parent')를 새 Task.parentTaskId로 이관.
-- fromTaskId가 자식, toTaskId가 부모였다(applyTaskLinks 주석 참고). 한 자식에
-- 부모가 여럿 걸려 있던 경우(스키마상 막혀있지 않았음) 가장 먼저 만들어진
-- 것만 채택하고 나머지는 버린다 — 진짜 계층은 부모가 하나여야 하기 때문.
UPDATE "Task" t SET "parentTaskId" = sub."toTaskId"
FROM (
  SELECT DISTINCT ON ("fromTaskId") "fromTaskId", "toTaskId"
  FROM "TaskLink" WHERE type = 'parent'
  ORDER BY "fromTaskId", "createdAt" ASC
) sub
WHERE t.id = sub."fromTaskId";

-- 이관 끝났으니 장식용 parent 타입 링크는 정리 — 앞으로 이 타입은 안 쓴다.
DELETE FROM "TaskLink" WHERE type = 'parent';

-- CreateTable
CREATE TABLE "TaskChecklistItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskChecklistItem_taskId_order_idx" ON "TaskChecklistItem"("taskId", "order");

-- CreateIndex
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
