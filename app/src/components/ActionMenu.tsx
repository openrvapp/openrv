// A menu of actions that looks native on each platform: a Material menu by its button on Android,
// an action sheet from the bottom of the screen on iOS.
import { useState, type ReactNode } from 'react';
import { ActionSheetIOS, Platform } from 'react-native';
import { Menu } from 'react-native-paper';

export interface MenuAction {
  label: string;
  /** Material icon, shown on Android. */
  icon?: string;
  /** The current choice: a check on Android, a check after the label on iOS. */
  selected?: boolean;
  /** Something that can't be undone, such as removing: red on iOS. */
  destructive?: boolean;
  onPress: () => void;
}

export function ActionMenu({
  title,
  actions,
  anchor,
}: {
  /** What the menu is about; iOS shows it at the top of the sheet. */
  title?: string;
  actions: MenuAction[];
  /** The button that opens the menu. */
  anchor: (open: () => void) => ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  if (Platform.OS === 'ios') {
    const open = () =>
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: [...actions.map((a) => (a.selected ? `${a.label} ✓` : a.label)), 'Cancel'],
          cancelButtonIndex: actions.length,
          destructiveButtonIndex: actions.flatMap((a, i) => (a.destructive ? [i] : [])),
        },
        (i) => actions[i]?.onPress(),
      );
    return <>{anchor(open)}</>;
  }

  return (
    <Menu visible={visible} onDismiss={() => setVisible(false)} anchor={anchor(() => setVisible(true))}>
      {actions.map((a) => (
        <Menu.Item
          key={a.label}
          title={a.label}
          leadingIcon={a.selected ? 'check' : a.icon}
          onPress={() => {
            setVisible(false);
            a.onPress();
          }}
        />
      ))}
    </Menu>
  );
}
