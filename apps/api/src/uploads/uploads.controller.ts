import {
  Body, Controller, Get, Param, Post, Res, UseGuards,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { UploadsService } from './uploads.service';
import { QuotesService } from '../quotes/quotes.service';
import { AuthGuard, TenantGuard } from '../common/guards';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { CurrentUser, CurrentUserInfo } from '../common/current-user.decorator';
import { tenantRoleAtLeast } from '@speed-enterprises/shared';

/** Minimal type for a multer uploaded file (avoids requiring @types/multer). */
interface UploadedFileInfo {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** True for staff/admin/owner or a platform admin — i.e. may touch any quote. */
function isStaffPlus(me: CurrentUserInfo): boolean {
  return me.platformRole === 'PLATFORM_ADMIN'
    || (me.tenantRole ? tenantRoleAtLeast(me.tenantRole, 'STAFF') : false);
}

interface PresignBody {
  filename: string;
  mimeType: string;
  byteSize: number;
  quoteRequestId?: string;
  quoteLineItemId?: string;
}

@ApiTags('uploads')
@Controller()
export class UploadsController {
  constructor(private uploads: UploadsService, private quotes: QuotesService) {}

  /** Authenticated presign — for logged-in customers + admins. */
  @UseGuards(TenantGuard, AuthGuard)
  @Post('uploads/presign')
  async presign(
    @CurrentTenant() tenantId: string,
    @CurrentUser()  me: CurrentUserInfo,
    @Body() body: PresignBody,
  ) {
    // A customer may only attach uploads to their own quote; staff+ may attach
    // to any. Prevents poisoning another customer's quote with arbitrary files.
    if (body.quoteRequestId && !isStaffPlus(me)) {
      await this.quotes.assertOwnedByUser(tenantId, me.id, body.quoteRequestId);
    }
    return this.uploads.presignUpload({
      tenantId,
      uploadedById: me.id,
      quoteRequestId: body.quoteRequestId,
      quoteLineItemId: body.quoteLineItemId,
      filename: body.filename,
      mimeType: body.mimeType,
      byteSize: body.byteSize,
    });
  }

  /** Anonymous presign for the public quote wizard. Throttled hard — 10/min/IP. */
  @UseGuards(TenantGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('public/uploads/presign')
  publicPresign(
    @CurrentTenant() tenantId: string,
    @Body() body: PresignBody,
  ) {
    return this.uploads.presignUpload({
      tenantId,
      uploadedById: null,
      filename: body.filename,
      mimeType: body.mimeType,
      byteSize: body.byteSize,
    });
  }

  @UseGuards(TenantGuard, AuthGuard)
  @Get('uploads/quote/:quoteId')
  async listForQuote(
    @CurrentTenant() tenantId: string,
    @CurrentUser() me: CurrentUserInfo,
    @Param('quoteId') quoteId: string,
  ) {
    if (!isStaffPlus(me)) await this.quotes.assertOwnedByUser(tenantId, me.id, quoteId);
    return this.uploads.listForQuote(tenantId, quoteId);
  }

  // ── Local-dev file storage (no S3 required) ────────────────────────────

  /**
   * Receives the raw file bytes from the mobile app in dev mode.
   * The presign endpoint emits method='POST' and uploadUrl pointing here
   * when S3 env vars are not configured.
   *
   * Intentionally NO auth guard — the presign already created the DB record
   * (with a tenant-scoped imageId) and the record ID is not guessable (cuid).
   * Rate limiting from the presign endpoint is the throttle boundary here.
   */
  @Post('uploads/:id/data')
  @UseInterceptors(FileInterceptor('file'))  // multer defaults to MemoryStorage → file.buffer
  async receiveLocalUpload(
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileInfo,
  ) {
    if (!file?.buffer) {
      return { ok: false, error: 'No file received' };
    }
    await this.uploads.storeLocalUpload(id, file.buffer);
    return { ok: true, imageId: id };
  }

  /**
   * Serves a locally-stored dev upload back to any viewer.
   * Only reachable when a file was actually stored by the POST above.
   */
  @Get('uploads/:id/data')
  async serveLocalUpload(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.uploads.getLocalUpload(id);
    res.set('Content-Type', mimeType);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }
}
