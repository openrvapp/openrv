// Imported first by index.ts: Android can start the app just to run the background alert check,
// without any screens, so the task must exist before Expo Router loads.
import { defineBackgroundCheck } from '@/features/monitoring/monitor';

defineBackgroundCheck();
