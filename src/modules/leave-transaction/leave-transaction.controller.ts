import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { LeaveTransactionService } from './leave-transaction.service';
import { CreditBalanceDto } from './dto/credit-balance.dto';
import { GenerateAccrualsDto } from './dto/generate-accruals.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

@Controller('leave-transactions')
export class LeaveTransactionController {
  constructor(private readonly service: LeaveTransactionService) {}

  @Get()
  @RequirePermission('CONGE_VOIR_TOUT')
  findAll(@Query('employeeId') employeeId?: string) {
    return this.service.findAll(employeeId);
  }

  @Get('balance/mine')
  getMyBalances(@CurrentUser('employeeId') employeeId: string) {
    return this.service.getBalances(employeeId);
  }

  // Doit rester avant ':employeeId' — sinon Nest matcherait "all" comme id.
  @Get('balance/all')
  @RequirePermission('CONGE_VOIR_TOUT')
  getAllBalances() {
    return this.service.getAllBalances();
  }

  @Get('balance/:employeeId')
  @RequirePermission('CONGE_VOIR_TOUT')
  getBalances(@Param('employeeId') employeeId: string) {
    return this.service.getBalances(employeeId);
  }

  // Déclenchement manuel (en plus du cron quotidien, voir AccrualSchedulerService)
  // — permet au RH de forcer une génération sans attendre le jour configuré.
  // dto.LeaveTypeId (optionnel) restreint à un seul type — utilisé par le
  // déclenchement automatique à la création d'un type de congé, pas par le
  // bouton manuel qui envoie un corps vide.
  @Post('generate-accruals')
  @RequirePermission('CONFIG_TYPES_CONGE')
  generateAccruals(@Body() dto: GenerateAccrualsDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.generateAccruals(employeeId, dto?.LeaveTypeId ? { leaveTypeId: dto.LeaveTypeId } : undefined);
  }

  // Credit ponctuel et manuel d'un employe pour un type de conge precis —
  // distinct de la generation automatique/en masse ci-dessus (regularisation,
  // geste RH, rattrapage). Meme permission que generate-accruals : les deux
  // affectent directement le solde des employes.
  @Post('credit')
  @RequirePermission('CONFIG_TYPES_CONGE')
  creditManual(@Body() dto: CreditBalanceDto, @CurrentUser('employeeId') employeeId: string) {
    return this.service.creditManual(dto.EmployeeId, dto.LeaveTypeId, dto.Amount, dto.Reason, employeeId);
  }
}
