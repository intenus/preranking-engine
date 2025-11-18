/**
 * @deprecated This module is no longer used in the new architecture
 * 
 * The batch processing workflow has been replaced with:
 * - Instant preranking: Solutions are validated immediately when SolutionSubmitted events arrive
 * - Redis storage: Intent and solution data stored in Redis instead of batch processing
 * - Event-driven: Direct event listeners instead of batch intervals
 * 
 * This module is kept for historical reference only.
 * Do not use in new code.
 */

export * from './batch.module';
export * from './batch.service';
export * from './batch.controller';
