import { Test, TestingModule } from '@nestjs/testing';
import { SolverPublisherService } from './solver-publisher.service';

describe('SolverPublisherService', () => {
  let service: SolverPublisherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SolverPublisherService],
    }).compile();

    service = module.get<SolverPublisherService>(SolverPublisherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
