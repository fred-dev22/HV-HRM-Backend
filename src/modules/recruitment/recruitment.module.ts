import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationModule } from '../notification/notification.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AttachmentModule } from '../attachment/attachment.module';
import { EmployeeModule } from '../employee/employee.module';

import { RecruitmentNotifyService } from './recruitment-notify.service';

import { HiringRequestController } from './hiring-request/hiring-request.controller';
import { HiringRequestService } from './hiring-request/hiring-request.service';
import { JobOfferController } from './job-offer/job-offer.controller';
import { JobOfferService } from './job-offer/job-offer.service';
import { EvalTemplateController } from './eval-template/eval-template.controller';
import { EvalTemplateService } from './eval-template/eval-template.service';
import { ApplicationController, MyApplicationsController } from './application/application.controller';
import { ApplicationService } from './application/application.service';
import { InterviewController } from './interview/interview.controller';
import { InterviewService } from './interview/interview.service';
import { InterviewRsvpPublicController } from './interview/interview-rsvp-public.controller';
import { InterviewRsvpService } from './interview/interview-rsvp.service';
import {
  ContractController,
  ContractTemplateController,
} from './contract/contract.controller';
import { ContractService } from './contract/contract.service';
import { EmployeeConversionService } from './contract/employee-conversion.service';
import { TrialController } from './trial/trial.controller';
import { TrialService } from './trial/trial.service';
import { TalentPoolController } from './talent-pool/talent-pool.controller';
import { TalentPoolService } from './talent-pool/talent-pool.service';
import { RecruitmentPublicController } from './public/recruitment-public.controller';
import { RecruitmentPublicService } from './public/recruitment-public.service';
import { RecruitmentAttachmentService } from './attachments/recruitment-attachment.service';
import { TurnstileService } from './public/turnstile.service';
import { DistributionChannelController } from './distribution/distribution-channel.controller';
import { DistributionChannelService } from './distribution/distribution-channel.service';
import { JobOfferDistributionController } from './distribution/job-offer-distribution.controller';
import { JobOfferDistributionService } from './distribution/job-offer-distribution.service';
import { DistributionDispatchService } from './distribution/distribution-dispatch.service';
import { JobFeedService } from './distribution/job-feed.service';
import { DistributionRetrySchedulerService } from './distribution/distribution-retry-scheduler.service';

// Module Recrutement (branche dev-recrutement-module) — un seul module qui
// regroupe toutes les sous-entites du domaine, cablees sur les memes
// services d'effets de bord (notifications, emails, temps reel) via
// RecruitmentNotifyService. AttachmentModule fournit SharePointService pour
// le depot de CV ; EmployeeModule fournit EmployeeService pour la conversion
// candidat -> employe.
@Module({
  imports: [MailModule, NotificationModule, RealtimeModule, AttachmentModule, EmployeeModule],
  controllers: [
    HiringRequestController,
    JobOfferController,
    EvalTemplateController,
    ApplicationController,
    MyApplicationsController,
    InterviewController,
    InterviewRsvpPublicController,
    ContractController,
    ContractTemplateController,
    TrialController,
    TalentPoolController,
    RecruitmentPublicController,
    DistributionChannelController,
    JobOfferDistributionController,
  ],
  providers: [
    RecruitmentNotifyService,
    HiringRequestService,
    JobOfferService,
    EvalTemplateService,
    ApplicationService,
    InterviewService,
    InterviewRsvpService,
    ContractService,
    EmployeeConversionService,
    TrialService,
    TalentPoolService,
    RecruitmentPublicService,
    RecruitmentAttachmentService,
    TurnstileService,
    DistributionChannelService,
    JobOfferDistributionService,
    DistributionDispatchService,
    JobFeedService,
    DistributionRetrySchedulerService,
  ],
})
export class RecruitmentModule {}
