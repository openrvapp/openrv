import { useTheme } from 'react-native-paper';
import { SvgXml } from 'react-native-svg';

import { MARK_SVG, WORDMARK_ASPECT, WORDMARK_DARK_SVG, WORDMARK_SVG } from '@/brand/artwork';

/** The OpenRV mark: the trailer on its teal tile. */
export function LogoMark({ size = 48 }: { size?: number }) {
  return <SvgXml xml={MARK_SVG} width={size} height={size} accessibilityLabel="OpenRV" />;
}

/** The OpenRV wordmark, in the colours for the current theme. */
export function Wordmark({ height = 32 }: { height?: number }) {
  const theme = useTheme();
  return (
    <SvgXml
      xml={theme.dark ? WORDMARK_DARK_SVG : WORDMARK_SVG}
      width={height * WORDMARK_ASPECT}
      height={height}
      accessibilityLabel="OpenRV"
    />
  );
}
