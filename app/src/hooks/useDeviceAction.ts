import { useState } from 'react';

import { capitalize } from '@/format';
import { GatewayError } from '@/protocol/client';
import type { Control, Device } from '@/protocol/types';
import { askPin, toast } from '@/store/dialogs';
import { useGateway } from '@/store/gateway';

const ERROR_TEXT: Record<string, string> = {
  unreachable: "The gateway couldn't reach the device.",
  not_authorized: 'Enter the gateway PIN in Settings first.',
  auth_failed: 'Wrong PIN.',
  refused: 'The gateway refused that command.',
  timeout: "The gateway didn't answer.",
  closed: 'Lost the connection to the gateway.',
};

/** Runs device commands with PIN prompts and error toasts; `pending` names the action in flight. */
export function useDeviceAction(device: Device) {
  const command = useGateway((s) => s.command);
  const authenticate = useGateway((s) => s.authenticate);
  // A gateway without a PIN lets everyone in, so there is nothing to ask for.
  const pinSet = useGateway((s) => s.hello?.auth.pin_set ?? false);
  const [pending, setPending] = useState<string>();

  async function run(action: string, values?: Record<string, unknown>, control?: Control): Promise<boolean> {
    if (pinSet && control?.kind === 'action' && control.pin?.includes(action)) {
      const pin = await askPin(`${capitalize(action)} ${device.name}`);
      if (!pin) return false;
      try {
        await authenticate(pin);
      } catch (e) {
        toast(describe(e));
        return false;
      }
    }
    setPending(action);
    try {
      await command(device.id, action, values);
      return true;
    } catch (e) {
      toast(describe(e));
      return false;
    } finally {
      setPending(undefined);
    }
  }

  return { run, pending };
}

function describe(e: unknown): string {
  if (e instanceof GatewayError) return ERROR_TEXT[e.code] ?? e.message;
  return (e as Error).message;
}
