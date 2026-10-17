-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationSentAt" TIMESTAMPTZ(3),
ADD COLUMN     "emailVerifiedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "userId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

