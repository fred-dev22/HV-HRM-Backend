import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApprovalPoolMemberService } from './approval-pool-member.service';
import { CreateApprovalPoolMemberDto } from './dto/create-approval-pool-member.dto';
import { UpdateApprovalPoolMemberDto } from './dto/update-approval-pool-member.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';

@Controller('approval-pool-members')
export class ApprovalPoolMemberController {
  constructor(private readonly service: ApprovalPoolMemberService) {}

  @Post()
  @RequirePermission('ENTITE_MODIFIER')
  create(
    @Body() dto: CreateApprovalPoolMemberDto,
    @CurrentUser('employeeId') employeeId: string,
  ) {
    return this.service.create(dto, employeeId);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('ENTITE_MODIFIER')
  update(@Param('id') id: string, @Body() dto: UpdateApprovalPoolMemberDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('ENTITE_MODIFIER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
