-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "position" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: seed each owner's positions to match the previous "updatedAt DESC" order
-- so existing notes keep their current ordering after the switch to position-based sort.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY "ownerId" ORDER BY "updatedAt" DESC) AS rn
  FROM "Note"
)
UPDATE "Note" n SET "position" = r.rn FROM ranked r WHERE n.id = r.id;

-- CreateIndex
CREATE INDEX "Note_ownerId_position_idx" ON "Note"("ownerId", "position");
