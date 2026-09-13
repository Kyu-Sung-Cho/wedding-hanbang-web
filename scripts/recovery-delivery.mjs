// A help/inspection entrypoint, not customer-source admission or a generic DB command.
// The actual native executor is exercised by its owned synthetic integration test.
import { restoreSyntheticDatabaseStage } from './lib/recovery-database-stage.mjs';
const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
  process.stdout.write(JSON.stringify({ kind: 'recovery-delivery-plan-v1', mode: 'plan-only',
    implemented: ['producer-artifact-byte-verifier', 'native-target-database-restore-and-row-compare'],
    executor: restoreSyntheticDatabaseStage.name, executionScope: 'owned synthetic source and empty loopback target only',
    customerAdmissionImplemented: false, currentSourceCollectorImplemented: false,
    storageServiceRestoreImplemented: false, authServiceRestoreVerified: false,
    credentialsRead: false, remoteCalls: 0, fullRestoreVerified: false, releaseAuthorized: false }) + '\n');
} else {
  process.stdout.write(JSON.stringify({ code: 'RECOVERY_CUSTOMER_ADMISSION_NOT_IMPLEMENTED', remoteCalls: 0 }) + '\n');
  process.exitCode = 2;
}
