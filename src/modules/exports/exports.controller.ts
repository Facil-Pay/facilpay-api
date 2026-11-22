import {
  Body,
  BadRequestException,
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
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExportsService } from './exports.service';
import { CreateExportDto } from './dto/create-export.dto';
import { AccountingAccountMappingsDto } from './dto/accounting-account-mappings.dto';

interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

@Controller('v1/exports')
@ApiTags('Exports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  /**
   * Enqueue a large export job. Returns the export job ID immediately so the
   * request thread is never blocked building the file.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Create a background data or accounting export' })
  @ApiAcceptedResponse({ description: 'Export job queued.' })
  @ApiBadRequestResponse({ description: 'Invalid export type, format, or filters.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateExportDto,
  ) {
    const userId = this.requireUser(req);
    if (dto.type && dto.resource && dto.type !== dto.resource) {
      throw new BadRequestException('type and resource must identify the same export');
    }
    const type = dto.type ?? dto.resource;
    if (!type) {
      throw new BadRequestException('An export type is required');
    }
    const job = await this.exportsService.createExport({
      type,
      format: dto.format,
      filters: { ...dto.filters, from: dto.from, to: dto.to, status: dto.status, currency: dto.currency },
      ownerId: userId,
    });
    return {
      id: job.id,
      status: job.status,
      type: job.type,
      format: job.format,
      createdAt: job.createdAt,
    };
  }

  @Get('account-mappings')
  @ApiOperation({ summary: 'Get this merchant’s accounting account mappings' })
  @ApiOkResponse({ description: 'Current mappings, or null when none are configured.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  async getAccountMappings(@Req() req: AuthenticatedRequest) {
    const userId = this.requireUser(req);
    return { mappings: await this.exportsService.getAccountMappings(userId) };
  }

  @Post('account-mappings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save this merchant’s accounting account mappings' })
  @ApiOkResponse({ description: 'Mappings saved.' })
  @ApiBadRequestResponse({ description: 'All platform account mappings are required.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  async saveAccountMappings(
    @Req() req: AuthenticatedRequest,
    @Body() mappings: AccountingAccountMappingsDto,
  ) {
    const userId = this.requireUser(req);
    return {
      mappings: await this.exportsService.saveAccountMappings(userId, mappings),
    };
  }

  /**
   * Poll the status of an export job. Only the owner may read it.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get the status of an export job' })
  @ApiOkResponse({ description: 'Export job status.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  async status(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const userId = this.requireUser(req);
    const job = await this.exportsService.getExport(id, userId);
    return {
      id: job.id,
      status: job.status,
      type: job.type,
      format: job.format,
      error: job.error ?? null,
      createdAt: job.createdAt,
      completedAt: job.status === 'completed' ? job.updatedAt : null,
      expiresAt: job.expiresAt ?? null,
      downloadUrl:
        job.status === 'completed'
          ? this.exportsService.buildDownloadUrl(job.id, userId)
          : null,
    };
  }

  /**
   * Stream the generated file back to its owner. The signed token in the query
   * string must match the job and must not be expired.
   */
  @Get(':id/download')
  @ApiOperation({ summary: 'Download a completed export' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  async download(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('token') token: string,
    @Query('expires') expires: string,
    @Res() res: Response,
  ) {
    const userId = this.requireUser(req);
    const { stream, filename, contentType } =
      await this.exportsService.openDownload(userId, id, Number(expires), token);

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
