import { Linking, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { safeLink } from '@/lib/places';
import type { Candidate } from '@/lib/types';

import { colors, fonts } from './theme';

/** The credit and source links Google requires wherever its content appears. */
export function GoogleCredit({
  place,
  light = false,
  style,
}: {
  place: Pick<Candidate, 'provider' | 'attributions' | 'googleMapsUri'>;
  light?: boolean;
  style?: ViewStyle;
}) {
  if (place.provider !== 'google') return null;
  const seen = new Set<string>();
  const credits = [
    { provider: 'Google Maps', uri: place.googleMapsUri },
    ...(place.attributions ?? []),
  ].filter((c) => !seen.has(c.provider) && !!seen.add(c.provider));
  const text = [styles.text, light && styles.light];
  return (
    <View style={[styles.row, style]}>
      {credits.map(({ provider, uri }) => {
        const link = safeLink(uri);
        return link ? (
          <Pressable
            key={provider}
            onPress={() => void Linking.openURL(link).catch(() => {})}
            hitSlop={12}
            accessibilityRole="link"
            accessibilityLabel={`${provider}, opens outside WTW`}
          >
            <Text style={[text, styles.link]}>{provider}</Text>
          </Pressable>
        ) : (
          <Text key={provider} style={text}>
            {provider}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8 },
  text: { fontFamily: fonts.medium, fontSize: 10, color: colors.muted },
  light: { color: 'rgba(255,255,255,0.85)' },
  link: { textDecorationLine: 'underline' },
});
