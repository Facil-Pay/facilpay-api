import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ExportsService } from './exports.service';
import { CreateExportDto } from './dto/create-export.dto';
import { ExportStatus } from './exports.types';

interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

@Controller('v1/exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  /**
   * Enqueue a large export job. Returns the export job ID immediately so the
   * request thread is never blocked building the file.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateExportDto,
  ) {
    const userId = this.requireUser(req);
    const job = await this.exportsService.enqueue(userId, dto);
    return {
      id: job.id,
      status: job.status,
      type: job.type,
      format: job.format,
      createdAt: job.createdAt,
    };
  }

  /**
   * Poll the status of an export job. Only the owner may read it.
   */
  @Get(':id')
  async status(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const userId = this.requireUser(req);
    const job = await this.exportsService.getOwned(userId, id);
    return {
      id: job.id,
      status: job.status,
      type: job.type,
      format: job.format,
      error: job.error ?? null,
      createdAt: job.createdAt,
      completedAt: job.completedAt ?? null,
      expiresAt: job.expiresAt ?? null,
      downloadUrl:
        job.status === ExportStatus.COMPLETED
          ? this.exportsService.buildDownloadUrl(job.id)
          : null,
    };
  }

  /**
   * Stream the generated file back to its owner. The signed token in the query
   * string must match the job and must not be expired.
   */
  @Get(':id/download')
  async download(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const userId = this.requireUser(req);
    const { stream, filename, contentType } =
      await this.exportsService.openDownload(userId, id, token);

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    stream.pipe(res);
  }

  private requireUser(req: AuthenticatedRequest): string {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }
    return userId;
  }
}
