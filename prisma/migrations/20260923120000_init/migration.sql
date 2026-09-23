-- CreateEnum
CREATE TYPE "PdfJobStatus" AS ENUM ('queued', 'processing', 'completed', 'failed', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "pdf_jobs" (
    "id" TEXT NOT NULL,
    "status" "PdfJobStatus" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "originalFilename" TEXT NOT NULL,
    "inputMimeType" TEXT NOT NULL,
    "inputSize" BIGINT NOT NULL,
    "inputStorageKey" TEXT NOT NULL,
    "outputStorageKey" TEXT,
    "outputMimeType" TEXT,
    "outputSize" BIGINT,
    "pageCount" INTEGER,
    "conversionEngine" TEXT,
    "pageSize" TEXT,
    "orientation" TEXT,
    "options" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "pdf_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "ownerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("ownerId","key")
);

-- CreateIndex
CREATE INDEX "pdf_jobs_status_idx" ON "pdf_jobs"("status");

-- CreateIndex
CREATE INDEX "pdf_jobs_createdAt_idx" ON "pdf_jobs"("createdAt");

-- CreateIndex
CREATE INDEX "pdf_jobs_expiresAt_idx" ON "pdf_jobs"("expiresAt");

-- CreateIndex
CREATE INDEX "pdf_jobs_ownerId_status_idx" ON "pdf_jobs"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_jobId_key" ON "idempotency_records"("jobId");

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "pdf_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
