import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { TENANT_DB } from '../database/tenant-db.provider';

interface PresignArgs {
  tenantId: string;
  uploadedById: string | null;
  quoteRequestId?: string;
  quoteLineItemId?: string;
  filename: string;
  mimeType: string;
  byteSize: number;
}

const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/heic', 'image/webp',
  'video/mp4', 'video/quicktime',
  'application/pdf',
]);
const MAX_SIZE_BYTES = 30 * 1024 * 1024;

/**
 * Upload service. When S3 env vars are set, issues real presigned PUT URLs
 * with strict tenant prefixing. Without them, falls back to a local-dev stub
 * so the rest of the app works on day one without AWS.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private s3: S3Client | null = null;
  private hasS3() { return !!(process.env.S3_BUCKET && process.env.S3_REGION); }

  // Single-plane service (UploadedImage lives in the tenant DB).
  constructor(@Inject(TENANT_DB) private prisma: PrismaClient) {
    if (this.hasS3()) {
      this.s3 = new S3Client({
        region: process.env.S3_REGION!,
        // Credentials picked up from env or IAM role if not provided
        ...(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? { credentials: {
              accessKeyId:     process.env.S3_ACCESS_KEY_ID!,
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
            } }
          : {}),
      });
    }
  }

  async presignUpload(args: PresignArgs) {
    if (!ALLOWED_MIMES.has(args.mimeType)) {
      throw new BadRequestException(`Unsupported file type: ${args.mimeType}`);
    }
    if (args.byteSize > MAX_SIZE_BYTES) {
      throw new BadRequestException(`File too large (max ${MAX_SIZE_BYTES / 1024 / 1024} MB)`);
    }

    const ext = mimeToExt(args.mimeType);
    const imageId = crypto.randomUUID();
    const key = `tenants/${args.tenantId}/quotes/${args.quoteRequestId ?? 'misc'}/${imageId}${ext}`;

    const record = await this.prisma.uploadedImage.create({
      data: {
        tenantId:        args.tenantId,
        quoteRequestId:  args.quoteRequestId ?? null,
        quoteLineItemId: args.quoteLineItemId ?? null,
        uploadedById:    args.uploadedById,
        s3Key:           key,
        s3Bucket:        process.env.S3_BUCKET ?? 'local-dev',
        mimeType:        args.mimeType,
        byteSize:        args.byteSize,
      },
    });

    if (this.s3 && process.env.S3_BUCKET) {
      const putCmd = new PutObjectCommand({
        Bucket:      process.env.S3_BUCKET!,
        Key:         key,
        ContentType: args.mimeType,
        ContentLength: args.byteSize,
        // Server-side encryption (cheap, default-on best practice)
        ServerSideEncryption: 'AES256',
        Metadata: { tenantId: args.tenantId, imageId: record.id },
      });
      const uploadUrl = await getSignedUrl(this.s3, putCmd, { expiresIn: 300 });

      const publicUrl = process.env.S3_PUBLIC_HOST
        ? `${process.env.S3_PUBLIC_HOST}/${key}`
        : await getSignedUrl(this.s3, new GetObjectCommand({
            Bucket: process.env.S3_BUCKET!, Key: key,
          }), { expiresIn: 60 * 60 });

      return {
        imageId: record.id,
        method: 'PUT',
        uploadUrl,
        publicUrl,
        headers: {
          'Content-Type': args.mimeType,
          'x-amz-server-side-encryption': 'AES256',
        },
        s3Key: key,
        expiresInSeconds: 300,
      };
    }

    // Local-dev fallback — caller POSTs the bytes back to /uploads/:id/data
    return {
      imageId: record.id,
      method: 'POST',
      uploadUrl: `${process.env.API_ORIGIN ?? 'http://localhost:4000'}/api/uploads/${record.id}/data`,
      publicUrl: `${process.env.API_ORIGIN ?? 'http://localhost:4000'}/api/uploads/${record.id}/data`,
      headers: { 'Content-Type': args.mimeType },
      s3Key: key,
      note: 'Local dev — no S3 configured. Configure S3_BUCKET + S3_REGION (+ credentials) to use real S3.',
    };
  }

  async listForQuote(tenantId: string, quoteId: string) {
    return this.prisma.uploadedImage.findMany({ where: { tenantId, quoteRequestId: quoteId } });
  }

  // ── Local-dev file storage ─────────────────────────────────────────────
  // When S3 is not configured the mobile app POSTs multipart FormData here.
  // Files are saved to UPLOADS_DIR (defaults to <tmpdir>/speed-enterprises-uploads).
  // The public URL is GET /api/uploads/:id/data, served by the controller.

  private get uploadsDir(): string {
    const dir = process.env.UPLOADS_DIR ?? path.join(os.tmpdir(), 'speed-enterprises-uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  localFilePath(imageId: string, mimeType: string): string {
    return path.join(this.uploadsDir, `${imageId}${mimeToExt(mimeType)}`);
  }

  async storeLocalUpload(imageId: string, fileBuffer: Buffer): Promise<void> {
    const image = await this.prisma.uploadedImage.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException(`Upload record ${imageId} not found`);
    const dest = this.localFilePath(imageId, image.mimeType);
    fs.writeFileSync(dest, fileBuffer);
    this.logger.log(`Local upload stored: ${dest}`);
  }

  async getLocalUpload(imageId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const image = await this.prisma.uploadedImage.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException(`Upload record ${imageId} not found`);
    const filePath = this.localFilePath(imageId, image.mimeType);
    if (!fs.existsSync(filePath)) throw new NotFoundException('File not found on disk');
    return { buffer: fs.readFileSync(filePath), mimeType: image.mimeType };
  }

  async attachToLineItem(tenantId: string, imageId: string, lineItemId: string) {
    const image = await this.prisma.uploadedImage.findFirst({ where: { id: imageId, tenantId } });
    if (!image) throw new BadRequestException('Unknown image');
    await this.prisma.uploadedImage.update({
      where: { id: imageId },
      data: { quoteLineItemId: lineItemId },
    });
  }
}

function mimeToExt(m: string): string {
  switch (m) {
    case 'image/jpeg': return '.jpg';
    case 'image/png':  return '.png';
    case 'image/heic': return '.heic';
    case 'image/webp': return '.webp';
    case 'video/mp4':  return '.mp4';
    case 'video/quicktime': return '.mov';
    case 'application/pdf': return '.pdf';
    default: return '';
  }
}
