import { Module } from '@nestjs/common';
import { ProviderController } from './provider/provider.controller';
import { ProviderService } from './provider/provider.service';
import { CourseController } from './course/course.controller';
import { CourseService } from './course/course.service';
import { SessionController } from './session/session.controller';
import { SessionService } from './session/session.service';
import { EnrollmentController } from './enrollment/enrollment.controller';
import { EnrollmentService } from './enrollment/enrollment.service';
import { BudgetController } from './budget/budget.controller';
import { BudgetService } from './budget/budget.service';

// Module Formation : catalogue, sessions, inscriptions (avec presence et
// evaluations a chaud / a froid), prestataires et budget. Un seul droit,
// FORMATION_ACCES, ouvre tout le module (meme principe que le Recrutement).
@Module({
  controllers: [
    ProviderController,
    CourseController,
    SessionController,
    EnrollmentController,
    BudgetController,
  ],
  providers: [ProviderService, CourseService, SessionService, EnrollmentService, BudgetService],
})
export class TrainingModule {}
