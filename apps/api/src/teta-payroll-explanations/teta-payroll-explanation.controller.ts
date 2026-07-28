/**
 * Stage 3J — REST API for payroll component explanations.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { PayrollExplanationFocus } from './teta-payroll-explanation.types';
import { STAGE3J_MAX_CODE_LENGTH, STAGE3J_MAX_DEPTH } from './teta-payroll-explanation.types';
import { TetaPayrollComponentExplanationService } from './teta-payroll-component-explanation.service';
import { mapExplanationToChatResponse } from './teta-payroll-component-response-mapper';

const FOCUS_VALUES: PayrollExplanationFocus[] = [
  'overview',
  'formula',
  'dependencies',
  'impact',
  'full',
];

@Controller('payroll-components')
@UseGuards(JwtAuthGuard)
export class TetaPayrollExplanationController {
  constructor(private readonly explanationService: TetaPayrollComponentExplanationService) {}

  @Get('search')
  search(@Query('q') q?: string) {
    return this.explanationService.searchComponents(q?.trim() ?? '');
  }

  @Post('explain')
  explain(@Body() body: { query?: string }) {
    if (!body?.query?.trim()) {
      throw new BadRequestException('Pole query jest wymagane.');
    }
    const explanation = this.explanationService.explain({ query: body.query.trim() });
    return mapExplanationToChatResponse(explanation);
  }

  @Get(':code/explanation')
  getByCode(
    @Param('code') code: string,
    @Query('focus') focus?: string,
    @Query('depth') depthRaw?: string,
  ) {
    const normalizedCode = code.trim();
    if (!normalizedCode || normalizedCode.length > STAGE3J_MAX_CODE_LENGTH) {
      throw new BadRequestException('Nieprawidłowy kod składnika.');
    }
    const focusVal = (focus ?? 'full') as PayrollExplanationFocus;
    if (!FOCUS_VALUES.includes(focusVal)) {
      throw new BadRequestException('Nieprawidłowy parametr focus.');
    }
    const depth = depthRaw ? Number(depthRaw) : undefined;
    if (depthRaw != null && (!Number.isFinite(depth) || depth! < 1 || depth! > STAGE3J_MAX_DEPTH)) {
      throw new BadRequestException('Parametr depth musi być liczbą od 1 do 10.');
    }
    const explanation = this.explanationService.explain({
      code: normalizedCode,
      focus: focusVal,
      depth,
    });
    return mapExplanationToChatResponse(explanation);
  }
}
