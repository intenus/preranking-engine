import { Entity, Column, PrimaryColumn, Index, CreateDateColumn } from 'typeorm';
import { Batch, BatchStatus } from '@intenus/common';

/**
 * Batch entity - implements the core Batch interface from @intenus/common
 * Only stores batch orchestration data, NOT solver or ranking results
 * 
 * Solver data: Managed on-chain (smart contracts)
 * Ranking data: Managed by Router Optimizer (TEE)
 * Archive data: Stored on Walrus (referenced here)
 */
@Entity('batches')
export class BatchEntity implements Batch {
  @PrimaryColumn('uuid')
  batch_id: string;

  @Column('bigint')
  @Index()
  epoch: number;

  @Column('bigint')
  start_time: number;

  @Column('bigint')
  end_time: number;

  @Column('bigint')
  solver_deadline: number;

  @Column('simple-array', { default: '' })
  intent_ids: string[];

  @Column('int', { default: 0 })
  intent_count: number;

  @Column('simple-json', { default: '{}' })
  categories: Record<string, number>;

  @Column('decimal', { precision: 20, scale: 2, default: 0 })
  estimated_value_usd: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: BatchStatus.OPEN
  })
  @Index()
  status: BatchStatus;

  // ===== ADDITIONAL FIELDS (Database-only) =====
  // These are for internal backend tracking, not part of the core Batch interface
  
  @CreateDateColumn()
  created_at: Date;
}
