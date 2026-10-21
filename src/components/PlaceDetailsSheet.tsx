import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  lookupDetails,
  useEnrichedPlace,
  useGoogleInfo,
  type GoogleDetails,
} from '@/lib/googlePlaces';
import { haptic } from '@/lib/haptics';
import type { Candidate, PreferenceValue } from '@/lib/types';

import { ActionBar } from './ActionBar';
import { Chips } from './PlaceCard';
import { colors, fonts } from './theme';

interface Props {
  place: Candidate | null;
  onClose: () => void;
  onAnswer: (value: PreferenceValue) => void;
}

/** Google lists hours Monday-first; JS getDay() is Sunday = 0. */
const todayIndex = () => (new Date().getDay() + 6) % 7;

function open(url: string) {
  haptic.tap();
  void Linking.openURL(url);
}

/** Tinder/Hinge-style "more info": scroll for photos, hours and links; answer from here too. */
export function PlaceDetailsSheet({ place, onClose, onAnswer }: Props) {
  return (
    <Modal
      visible={!!place}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {place ? <Details place={place} onClose={onClose} onAnswer={onAnswer} /> : null}
    </Modal>
  );
}

function Details({ place: base, onClose, onAnswer }: { place: Candidate } & Omit<Props, 'place'>) {
  const place = useEnrichedPlace(base);
  const info = useGoogleInfo(base);
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [details, setDetails] = useState<GoogleDetails | null>(null);

  useEffect(() => {
    let active = true;
    if (info?.id) lookupDetails(info.id).then((d) => active && setDetails(d));
    return () => {
      active = false;
    };
  }, [info?.id]);

  const gallery = info?.gallery.length
    ? info.gallery
    : base.photoUrl
      ? [{ url: base.photoUrl, credit: 'Wikimedia Commons (cuisine photo)' }]
      : [];
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [base.name, base.address].filter(Boolean).join(', '),
  )}`;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ height: 380 }}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
            onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
            scrollEventThrottle={64}
          >
            {gallery.map((g) => (
              <View key={g.url} style={{ width, height: 380 }}>
                <Image source={{ uri: g.url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                {g.credit ? (
                  <Text style={styles.credit}>
                    Photo: {g.credit}
                    {info?.gallery.length ? ' · Google' : ''}
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
          <LinearGradient
            colors={['rgba(14,11,18,0.55)', 'transparent', 'transparent', colors.bg]}
            locations={[0, 0.25, 0.7, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.dots} pointerEvents="none">
            {gallery.map((g, i) => (
              <View key={g.url} style={[styles.dot, i === page && styles.dotOn]} />
            ))}
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close details"
            style={styles.close}
          >
            <Ionicons name="chevron-down" size={24} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={styles.body}>
          <Text style={styles.name} accessibilityRole="header">
            {base.name}
          </Text>
          <Chips place={place} light={false} />
          <View style={styles.metaRow}>
            {details?.openNow != null ? (
              <View
                style={[styles.pill, { backgroundColor: details.openNow ? '#113D2A' : '#3A1620' }]}
              >
                <View
                  style={[
                    styles.pillDot,
                    { backgroundColor: details.openNow ? colors.yes : colors.no },
                  ]}
                />
                <Text style={styles.pillText}>{details.openNow ? 'Open now' : 'Closed now'}</Text>
              </View>
            ) : null}
            {info?.ratingCount ? (
              <Text style={styles.muted}>
                ★ {info.rating?.toFixed(1)} · {info.ratingCount.toLocaleString()} Google reviews
              </Text>
            ) : null}
          </View>

          {details?.summary ? <Text style={styles.summary}>{details.summary}</Text> : null}

          <View style={styles.buttons}>
            <LinkButton icon="navigate" label="Directions" onPress={() => open(directions)} />
            {details?.phone ? (
              <LinkButton
                icon="call"
                label="Call"
                onPress={() => open(`tel:${details.phone!.replace(/[^\d+]/g, '')}`)}
              />
            ) : null}
            {details?.website ? (
              <LinkButton
                icon="globe-outline"
                label="Website"
                onPress={() => open(details.website!)}
              />
            ) : null}
          </View>

          <Section title="About">
            {details?.type ? <Row icon="restaurant" text={details.type} /> : null}
            {base.cuisine && base.cuisine !== details?.type ? (
              <Row icon="pricetag" text={base.cuisine} />
            ) : null}
            {base.address ? <Row icon="location-sharp" text={base.address} /> : null}
          </Section>

          {details?.hours.length ? (
            <Section title="Hours">
              {details.hours.map((h, i) => (
                <Text key={h} style={[styles.hour, i === todayIndex() && styles.hourToday]}>
                  {h}
                </Text>
              ))}
            </Section>
          ) : null}
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <ActionBar placeName={base.name} onAnswer={onAnswer} compact />
      </SafeAreaView>
    </View>
  );
}

function LinkButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={16} color={colors.muted} />
      <Text style={styles.rowText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  credit: {
    position: 'absolute',
    right: 12,
    bottom: 34,
    fontFamily: fonts.medium,
    fontSize: 10,
    color: 'rgba(255,255,255,0.8)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  dots: {
    position: 'absolute',
    top: 14,
    left: 70,
    right: 70,
    flexDirection: 'row',
    gap: 4,
  },
  dot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotOn: { backgroundColor: '#FFFFFF' },
  close: {
    position: 'absolute',
    top: 10,
    left: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,11,18,0.55)',
  },
  body: { paddingHorizontal: 20, gap: 14, marginTop: -8 },
  name: { fontFamily: fonts.black, fontSize: 30, lineHeight: 36, color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
  muted: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  summary: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24, color: colors.text },
  buttons: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  linkText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  section: {
    gap: 10,
    padding: 16,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  hour: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  hourToday: { fontFamily: fonts.bold, color: colors.text },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
