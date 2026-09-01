-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT 'ALL',
    "userId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Broadcast_targetType_userId_idx" ON "Broadcast"("targetType", "userId");

-- CreateIndex
CREATE INDEX "Broadcast_createdAt_idx" ON "Broadcast"("createdAt");

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
