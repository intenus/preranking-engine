import { Test, TestingModule } from '@nestjs/testing';
import { BatchSchedulerService } from './batch-scheduler.service';

describe('BatchSchedulerService', () => {
  let service: BatchSchedulerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BatchSchedulerService],
    }).compile();

    service = module.get<BatchSchedulerService>(BatchSchedulerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
