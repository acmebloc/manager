-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "endAt" TIMESTAMP(3),
ADD COLUMN     "startAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSiteAdmin" BOOLEAN NOT NULL DEFAULT false;


-- Enforce "only one site admin" at the DB level, not just in application
-- code — a partial index so any number of `false` rows coexist, but a
-- second `true` row is rejected outright.
CREATE UNIQUE INDEX "User_isSiteAdmin_singleton" ON "User" ("isSiteAdmin") WHERE "isSiteAdmin" = true;

-- Remap the old three-tier role names to the new ones. 'admin' becomes
-- 'pm' (same top tier). The read-only 'viewer' tier no longer exists as a
-- concept — every project member can now write tasks/schedules — so
-- existing viewers are promoted to plain 'member' rather than dropped from
-- their projects.
UPDATE "ProjectMember" SET role = 'pm' WHERE role = 'admin';
UPDATE "ProjectMember" SET role = 'member' WHERE role = 'viewer';
