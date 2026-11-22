import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('invoices')
@ApiBearerAuth('bearer')
@Controller('v1/invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  create(@Body() dto: CreateInvoiceDto, @Req() req: any) {
    return this.invoicesService.create(req.user.id, dto);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.invoicesService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.invoicesService.findOne(req.user.id, id);
  }

  @Get(':id/pdf')
  streamPdf(@Param('id') id: string, @Req() req: any, @Res() response: Response) {
    return this.invoicesService.streamPdf(req.user.id, id, response);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto, @Req() req: any) {
    return this.invoicesService.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.invoicesService.remove(req.user.id, id);
  }

  @Post(':id/send')
  send(@Param('id') id: string, @Req() req: any) {
    return this.invoicesService.send(req.user.id, id);
  }

  @Post(':id/void')
  void(@Param('id') id: string, @Req() req: any) {
    return this.invoicesService.void(req.user.id, id);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @Req() req: any) {
    return this.invoicesService.duplicate(req.user.id, id);
  }
}