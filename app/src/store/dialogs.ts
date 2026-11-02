import { create } from 'zustand';

interface PinRequest {
  title: string;
  resolve: (pin: string | null) => void;
}

interface DialogState {
  pin?: PinRequest;
  message?: string;
}

export const useDialogs = create<DialogState>()(() => ({}));

/** Shows the PIN dialog; resolves with the PIN, or null if cancelled. */
export function askPin(title: string): Promise<string | null> {
  return new Promise((resolve) => useDialogs.setState({ pin: { title, resolve } }));
}

export function answerPin(pin: string | null): void {
  useDialogs.getState().pin?.resolve(pin);
  useDialogs.setState({ pin: undefined });
}

/** A short message in a snackbar. */
export function toast(message: string): void {
  useDialogs.setState({ message });
}
