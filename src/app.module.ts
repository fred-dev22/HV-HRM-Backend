import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationUnitModule } from './modules/organization-unit/organization-unit.module';
import { JobModule } from './modules/job/job.module';
import { PositionModule } from './modules/position/position.module';
import { UserModule } from './modules/user/user.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { ApprovalPoolModule } from './modules/approval-pool/approval-pool.module';
import { ApprovalPoolMemberModule } from './modules/approval-pool-member/approval-pool-member.module';
import { LeaveTypeModule } from './modules/leave-type/leave-type.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { HolidayModule } from './modules/holiday/holiday.module';
import { CompanySettingsModule } from './modules/company-settings/company-settings.module';
import { EmployeeCategoryModule } from './modules/employee-category/employee-category.module';
import { ExpenseTypeModule } from './modules/expense-type/expense-type.module';
import { ExpenseConfigModule } from './modules/expense-config/expense-config.module';
import { ExpenseCeilingModule } from './modules/expense-ceiling/expense-ceiling.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { LeaveRequestModule } from './modules/leave-request/leave-request.module';
import { LeaveTransactionModule } from './modules/leave-transaction/leave-transaction.module';
import { MissionOrderModule } from './modules/mission-order/mission-order.module';
import { ExpenseReportModule } from './modules/expense-report/expense-report.module';
import { MailModule } from './modules/mail/mail.module';
import { NotificationModule } from './modules/notification/notification.module';
import { AttachmentModule } from './modules/attachment/attachment.module';
import { PublicApprovalModule } from './modules/public-approval/public-approval.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    OrganizationUnitModule,
    JobModule,
    PositionModule,
    UserModule,
    EmployeeModule,
    ApprovalPoolModule,
    ApprovalPoolMemberModule,
    LeaveTypeModule,
    CalendarModule,
    HolidayModule,
    CompanySettingsModule,
    EmployeeCategoryModule,
    ExpenseTypeModule,
    ExpenseConfigModule,
    ExpenseCeilingModule,
    RbacModule,
    LeaveRequestModule,
    LeaveTransactionModule,
    MissionOrderModule,
    ExpenseReportModule,
    MailModule,
    NotificationModule,
    AttachmentModule,
    PublicApprovalModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
