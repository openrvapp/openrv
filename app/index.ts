// The app's entry: the background alert check first (see src/features/monitoring/task.ts), then
// Expo Router starts the app as usual. Imports run in this order.
import '@/features/monitoring/task';
import 'expo-router/entry';
