-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "senderNik" TEXT NOT NULL,
    "receiverNik" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_senderNik_receiverNik_timestamp_idx" ON "messages"("senderNik", "receiverNik", "timestamp");

-- CreateIndex
CREATE INDEX "messages_receiverNik_senderNik_timestamp_idx" ON "messages"("receiverNik", "senderNik", "timestamp");
