-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'settle-worker',
    "gameId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "payload" TEXT,
    "payloadHash" TEXT,
    "settled" INTEGER NOT NULL DEFAULT 0,
    "voided" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameStats" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "htHomeCorners" INTEGER,
    "htAwayCorners" INTEGER,
    "ftHomeCorners" INTEGER,
    "ftAwayCorners" INTEGER,
    "htHomeYellows" INTEGER,
    "htAwayYellows" INTEGER,
    "ftHomeYellows" INTEGER,
    "ftAwayYellows" INTEGER,
    "htHomeReds" INTEGER,
    "htAwayReds" INTEGER,
    "ftHomeReds" INTEGER,
    "ftAwayReds" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'settle-worker',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_gameId_idx" ON "WebhookEvent"("gameId");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameStats_gameId_key" ON "GameStats"("gameId");

-- CreateIndex
CREATE INDEX "GameStats_updatedAt_idx" ON "GameStats"("updatedAt");

-- AddForeignKey
ALTER TABLE "GameStats" ADD CONSTRAINT "GameStats_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

