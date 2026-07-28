import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { GustoPayrollProvider, PAYROLL_PROVIDER } from './payroll-provider';
import { TimeModule } from '../time/time.module';

@Module({
  imports: [TimeModule], // reuse TimeService.payrollSummary for draft-run hours
  controllers: [PayrollController],
  providers: [
    PayrollService,
    // The active embedded-payroll provider. Swap the class to change providers.
    { provide: PAYROLL_PROVIDER, useClass: GustoPayrollProvider },
  ],
  exports: [PayrollService],
})
export class PayrollModule {}
