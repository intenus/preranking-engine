import { Test, TestingModule } from '@nestjs/testing';
import { ConstraintValidator } from './constraint.validator';
import type { IGSIntent } from '../../../common/types/igs-intent.types';
import type { IGSSolution } from '../../../common/types/igs-solution.types';

describe('ConstraintValidator', () => {
  let validator: ConstraintValidator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConstraintValidator],
    }).compile();

    validator = module.get<ConstraintValidator>(ConstraintValidator);
  });

  describe('deadline validation', () => {
    it('should reject solution submitted after deadline', async () => {
      const intent: IGSIntent = {
        igsVersion: '1.0.0',
        object: {
          userAddress: '0x123',
          createdTs: Date.now(),
          policy: {
            solverAccessWindow: { startMs: Date.now(), endMs: Date.now() + 10000 },
            autoRevokeTime: Date.now() + 20000,
            accessCondition: {
              requiresSolverRegistration: false,
              minSolverStake: '0',
              requiresTeeAttestation: false,
              expectedMeasurement: '',
              purpose: 'test',
            },
          },
        },
        userAddress: '0x123',
        intentType: 'swap.exact_input',
        operation: {
          mode: 'exact_input',
          inputs: [
            {
              assetId: '0x2::sui::SUI',
              amount: { type: 'exact', value: '1000000000' },
            },
          ],
          outputs: [
            {
              assetId: '0xusdc::usdc::USDC',
              amount: { type: 'range', min: '0', max: '999999' },
            },
          ],
        },
        constraints: {
          deadlineMs: Date.now() - 1000, // Deadline in the past
        },
      };

      const solution: IGSSolution = {
        solverAddress: '0xsolver',
        transactionBytes: 'mockTxBytes',
      };

      const result = await validator.validate(intent, solution);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('constraints.deadlineMs');
      expect(result.errors[0].severity).toBe('error');
    });

    it('should accept solution submitted before deadline', async () => {
      const intent: IGSIntent = {
        igsVersion: '1.0.0',
        object: {
          userAddress: '0x123',
          createdTs: Date.now(),
          policy: {
            solverAccessWindow: { startMs: Date.now(), endMs: Date.now() + 10000 },
            autoRevokeTime: Date.now() + 20000,
            accessCondition: {
              requiresSolverRegistration: false,
              minSolverStake: '0',
              requiresTeeAttestation: false,
              expectedMeasurement: '',
              purpose: 'test',
            },
          },
        },
        userAddress: '0x123',
        intentType: 'swap.exact_input',
        operation: {
          mode: 'exact_input',
          inputs: [
            {
              assetId: '0x2::sui::SUI',
              amount: { type: 'exact', value: '1000000000' },
            },
          ],
          outputs: [
            {
              assetId: '0xusdc::usdc::USDC',
              amount: { type: 'range', min: '0', max: '999999' },
            },
          ],
        },
        constraints: {
          deadlineMs: Date.now() + 10000, // Deadline in the future
        },
      };

      const solution: IGSSolution = {
        solverAddress: '0xsolver',
        transactionBytes: 'mockTxBytes',
      };

      const result = await validator.validate(intent, solution);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('slippage validation', () => {
    it('should reject solution with slippage exceeding maxSlippageBps', async () => {
      const intent: IGSIntent = {
        igsVersion: '1.0.0',
        object: {
          userAddress: '0x123',
          createdTs: Date.now(),
          policy: {
            solverAccessWindow: { startMs: Date.now(), endMs: Date.now() + 10000 },
            autoRevokeTime: Date.now() + 20000,
            accessCondition: {
              requiresSolverRegistration: false,
              minSolverStake: '0',
              requiresTeeAttestation: false,
              expectedMeasurement: '',
              purpose: 'test',
            },
          },
        },
        userAddress: '0x123',
        intentType: 'swap.exact_input',
        operation: {
          mode: 'exact_input',
          inputs: [
            {
              assetId: '0x2::sui::SUI',
              amount: { type: 'exact', value: '1000000000' },
            },
          ],
          outputs: [
            {
              assetId: '0xusdc::usdc::USDC',
              amount: { type: 'range', min: '0', max: '999999' },
            },
          ],
          expectedOutcome: {
            expectedOutputs: [
              {
                assetId: '0xusdc::usdc::USDC',
                amount: '100000', // Expected 100 USDC (6 decimals)
              },
            ],
          },
        },
        constraints: {
          maxSlippageBps: 100, // Max 1% slippage
        },
      };

      const solution: IGSSolution = {
        solverAddress: '0xsolver',
        transactionBytes: 'mockTxBytes',
      };

      const mockDryRunResult = {
        effects: {
          balanceChanges: [
            {
              coinType: '0xusdc::usdc::USDC',
              amount: '95000', 
            },
          ],
        },
      };

      const result = await validator.validateComplexConstraints(intent, solution, mockDryRunResult);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].field).toBe('constraints.maxSlippageBps');
    });
  });

  describe('min output validation', () => {
    it('should reject solution with output below minimum', async () => {
      const intent: IGSIntent = {
        igsVersion: '1.0.0',
        object: {
          userAddress: '0x123',
          createdTs: Date.now(),
          policy: {
            solverAccessWindow: { startMs: Date.now(), endMs: Date.now() + 10000 },
            autoRevokeTime: Date.now() + 20000,
            accessCondition: {
              requiresSolverRegistration: false,
              minSolverStake: '0',
              requiresTeeAttestation: false,
              expectedMeasurement: '',
              purpose: 'test',
            },
          },
        },
        userAddress: '0x123',
        intentType: 'swap.exact_input',
        operation: {
          mode: 'exact_input',
          inputs: [
            {
              assetId: '0x2::sui::SUI',
              amount: { type: 'exact', value: '1000000000' },
            },
          ],
          outputs: [
            {
              assetId: '0xusdc::usdc::USDC',
              amount: { type: 'range', min: '0', max: '999999' },
            },
          ],
        },
        constraints: {
          minOutputs: [
            {
              assetId: '0xusdc::usdc::USDC',
              amount: '100000', 
            },
          ],
        },
      };

      const solution: IGSSolution = {
        solverAddress: '0xsolver',
        transactionBytes: 'mockTxBytes',
      };

      const mockDryRunResult = {
        effects: {
          balanceChanges: [
            {
              coinType: '0xusdc::usdc::USDC',
              amount: '50000', // Only 50 USDC
            },
          ],
        },
      };

      const result = await validator.validateComplexConstraints(intent, solution, mockDryRunResult);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].field).toBe('constraints.minOutputs');
    });
  });

  describe('gas cost validation', () => {
    it('should reject solution exceeding max gas cost', async () => {
      const intent: IGSIntent = {
        igsVersion: '1.0.0',
        object: {
          userAddress: '0x123',
          createdTs: Date.now(),
          policy: {
            solverAccessWindow: { startMs: Date.now(), endMs: Date.now() + 10000 },
            autoRevokeTime: Date.now() + 20000,
            accessCondition: {
              requiresSolverRegistration: false,
              minSolverStake: '0',
              requiresTeeAttestation: false,
              expectedMeasurement: '',
              purpose: 'test',
            },
          },
        },
        userAddress: '0x123',
        intentType: 'swap.exact_input',
        operation: {
          mode: 'exact_input',
          inputs: [
            {
              assetId: '0x2::sui::SUI',
              amount: { type: 'exact', value: '1000000000' },
            },
          ],
          outputs: [
            {
              assetId: '0xusdc::usdc::USDC',
              amount: { type: 'range', min: '0', max: '999999' },
            },
          ],
        },
        constraints: {
          maxGasCost: {
            assetId: '0x2::sui::SUI',
            amount: '10000000', // Max 0.01 SUI
          },
        },
      };

      const solution: IGSSolution = {
        solverAddress: '0xsolver',
        transactionBytes: 'mockTxBytes',
      };

      const mockDryRunResult = {
        effects: {
          gasUsed: {
            computationCost: '15000000', // 0.015 SUI (exceeds limit)
            storageCost: '1000000',
            storageRebate: '0',
          },
        },
      };

      const result = await validator.validateComplexConstraints(intent, solution, mockDryRunResult);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].field).toBe('constraints.maxGasCost');
    });
  });

  describe('no constraints', () => {
    it('should accept solution when no constraints are defined', async () => {
      const intent: IGSIntent = {
        igsVersion: '1.0.0',
        object: {
          userAddress: '0x123',
          createdTs: Date.now(),
          policy: {
            solverAccessWindow: { startMs: Date.now(), endMs: Date.now() + 10000 },
            autoRevokeTime: Date.now() + 20000,
            accessCondition: {
              requiresSolverRegistration: false,
              minSolverStake: '0',
              requiresTeeAttestation: false,
              expectedMeasurement: '',
              purpose: 'test',
            },
          },
        },
        userAddress: '0x123',
        intentType: 'swap.exact_input',
        operation: {
          mode: 'exact_input',
          inputs: [
            {
              assetId: '0x2::sui::SUI',
              amount: { type: 'exact', value: '1000000000' },
            },
          ],
          outputs: [
            {
              assetId: '0xusdc::usdc::USDC',
              amount: { type: 'range', min: '0', max: '999999' },
            },
          ],
        },
        // No constraints
      };

      const solution: IGSSolution = {
        solverAddress: '0xsolver',
        transactionBytes: 'mockTxBytes',
      };

      const result = await validator.validate(intent, solution);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
