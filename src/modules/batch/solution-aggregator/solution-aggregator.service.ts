// import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// import { RedisPubsubService } from 'src/modules/redis/redis-pubsub/redis-pubsub.service';
// import { BatchService } from '../batch.service';
// import { SubmitSolutionDto } from '../dto/batch.dto';

// @Injectable()
// export class SolutionAggregatorService implements OnModuleInit {
//   private readonly logger = new Logger(SolutionAggregatorService.name);

//   constructor(
//     private readonly redis: RedisPubsubService,
//     private readonly batchService: BatchService,
//   ) {}

//   async onModuleInit() {
//     await this.subscribeToSolutionChannel();
//   }

//   /**
//    * Subscribe to solver solution submissions
//    */
//   private async subscribeToSolutionChannel() {
//     await this.redis.subscribe('intenus:solution:*', async (handler) => {
//       try {
//         await this.handleSolutionSubmission(handler.channel, handler.message);
//       } catch (error) {
//         this.logger.error('Error handling solution submission', error);
//       }
//     });

//     this.logger.log('Subscribed to solver solution channel');
//   }

//   /**
//    * Handle solution submission from solver
//    */
//   private async handleSolutionSubmission(channel: string, message: string) {
//     // Extract batch_id from channel: solver:solution:{batch_id}
//     const parts = channel.split(':');
//     const batch_id = parts[2];

//     const submission: SubmitSolutionDto = JSON.parse(message);

//     this.logger.log(
//       `Received solution ${submission.solution_id} for batch ${batch_id} from ${submission.solver_address}`
//     );

//     // Validate and store solution
//     try {
//       await this.validateSubmission(submission, batch_id);
//       await this.batchService.submitSolution(submission);
      
//       this.logger.log(
//         `Solution ${submission.solution_id} validated and stored`
//       );
//     } catch (error) {
//       this.logger.error(
//         `Failed to process solution ${submission.solution_id}:`,
//         error.message
//       );
//     }
//   }

//   /**
//    * Validate solution submission
//    */
//   private async validateSubmission(
//     submission: SubmitSolutionDto,
//     batch_id: string
//   ): Promise<void> {
//     if (submission.batch_id !== batch_id) {
//       throw new Error('Batch ID mismatch');
//     }
//     // await this.verifySolverRegistration(submission.solver_address);

//     // Check submission before deadline
//     const batch = await this.batchService.getBatch(batch_id);
//     const now = Date.now();
    
//     if (now > batch.solver_deadline) {
//       throw new Error('Submission after deadline');
//     }

//     // Basic sanity checks
//     if (!submission.outcomes || submission.outcomes.length === 0) {
//       throw new Error('No outcomes provided');
//     }

//     if (!submission.walrus_blob_id) {
//       throw new Error('Missing PTB blob ID');
//     }

//     // 5. Check TEE attestation if required (high value batches)
//     if (Number(batch.estimated_value_usd) > 10000) {
//       if (!submission.tee_attestation) {
//         this.logger.warn(
//           `High value batch ${batch_id} solution missing TEE attestation`
//         );
//       }
//     }
//   }

//   /**
//    * Verify solver is registered and staked on-chain
//    * TODO: Implement Sui blockchain verification
//    */
//   private async verifySolverRegistration(solver_address: string): Promise<void> {
//     // Query Sui blockchain for solver registration
//     // Check minimum stake requirement
//     // Verify solver not slashed
    
//     // Placeholder
//     this.logger.debug(`Verifying solver ${solver_address} registration`);
//   }
// }
