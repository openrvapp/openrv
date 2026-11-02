import { useState } from 'react';
import { Button, Dialog, Portal, Snackbar, TextInput } from 'react-native-paper';

import { answerPin, useDialogs } from '@/store/dialogs';

/** App-wide dialogs that any screen can open through store/dialogs. */
export function DialogHost() {
  const pin = useDialogs((s) => s.pin);
  const message = useDialogs((s) => s.message);
  const [value, setValue] = useState('');

  const close = (answer: string | null) => {
    answerPin(answer);
    setValue('');
  };

  return (
    <Portal>
      <Dialog visible={!!pin} onDismiss={() => close(null)}>
        <Dialog.Title>{pin?.title}</Dialog.Title>
        <Dialog.Content>
          <TextInput
            label="Gateway PIN"
            value={value}
            onChangeText={setValue}
            secureTextEntry
            keyboardType="number-pad"
            autoFocus
            onSubmitEditing={() => value && close(value)}
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => close(null)}>Cancel</Button>
          <Button onPress={() => close(value)} disabled={!value}>
            OK
          </Button>
        </Dialog.Actions>
      </Dialog>
      <Snackbar visible={!!message} onDismiss={() => useDialogs.setState({ message: undefined })} duration={3000}>
        {message}
      </Snackbar>
    </Portal>
  );
}
