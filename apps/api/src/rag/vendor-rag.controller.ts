import { Controller, Get, UseGuards } from '@nestjs/common';
import { GlobalRagService } from './global-rag.service';
import { VendorAccessGuard } from './vendor-access.guard';

@Controller('vendor/rag')
@UseGuards(VendorAccessGuard)
export class VendorRagController {
  constructor(private readonly globalRag: GlobalRagService) {}

  @Get('status')
  getStatus() {
    return this.globalRag.getStatus();
  }
}
