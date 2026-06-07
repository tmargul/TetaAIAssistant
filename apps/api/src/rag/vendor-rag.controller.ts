import { Controller, Get, UseGuards } from '@nestjs/common';
import { GlobalRagService } from './global-rag.service';
import { VendorGuard } from './vendor.guard';

@Controller('vendor/rag')
@UseGuards(VendorGuard)
export class VendorRagController {
  constructor(private readonly globalRag: GlobalRagService) {}

  @Get('status')
  getStatus() {
    return this.globalRag.getStatus();
  }
}
