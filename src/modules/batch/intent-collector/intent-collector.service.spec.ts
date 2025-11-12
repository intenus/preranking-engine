import { Test, TestingModule } from '@nestjs/testing';
import { IntentCollectorService } from './intent-collector.service';

describe('IntentCollectorService', () => {
  let service: IntentCollectorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IntentCollectorService],
    }).compile();

    service = module.get<IntentCollectorService>(IntentCollectorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
