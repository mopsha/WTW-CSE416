import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import {
  Button,
  colors,
  Illustration,
  type IllustrationBadge,
  OnboardingCopy,
  onboardingStyles,
  PageDots,
  Screen,
  space,
} from '@/components';
import type { AuthMode } from '@/lib/authTypes';
import { markIntroSeen } from '@/lib/intro';
import { openLegalPage, PRIVACY_URL, TERMS_URL } from '@/lib/legal';

const SLIDES: {
  key: string;
  icon: IllustrationBadge['icon'];
  badges?: IllustrationBadge[];
  title: string;
  body: string;
}[] = [
  {
    key: 'swipe',
    icon: 'albums',
    badges: [
      { icon: 'checkmark', color: colors.yes },
      { icon: 'help', color: colors.maybe },
      { icon: 'close', color: colors.no },
    ],
    title: 'Swipe',
    body: 'Rate nearby spots Yes, Maybe or No. Only you see your swipes.',
  },
  {
    key: 'together',
    icon: 'people',
    title: 'Decide together',
    body: "WTW ranks everyone's picks so the group lands on a favorite.",
  },
  {
    key: 'go',
    icon: 'trophy',
    title: 'Go',
    body: 'Get one winner, then make the plan.',
  },
];

// Signed-out first run only: the root layout lists this before sign-in until it's been seen.
export default function IntroScreen() {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const pager = useRef<ScrollView>(null);
  const leaving = useRef(false);
  // The pager spans the screen; Screen's padding is cancelled so slides snap to full width.
  const gutter = space.xl - 4;

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    setPage(Math.min(Math.max(next, 0), SLIDES.length - 1));
  }

  function goTo(index: number) {
    setPage(index);
    pager.current?.scrollTo({ x: index * width, animated: true });
  }

  async function start(mode: AuthMode) {
    if (leaving.current) return;
    leaving.current = true;
    await markIntroSeen();
    router.replace({ pathname: '/sign-in', params: { mode } });
    leaving.current = false;
  }

  return (
    <Screen contentStyle={styles.frame}>
      <View style={{ marginHorizontal: -gutter }}>
        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          accessibilityLabel="WTW intro"
        >
          {SLIDES.map((slide) => (
            <View
              key={slide.key}
              style={[styles.slide, { width, paddingHorizontal: gutter }]}
              testID={`intro-slide-${slide.key}`}
            >
              <Illustration icon={slide.icon} badges={slide.badges} />
              <OnboardingCopy title={slide.title} body={slide.body} />
            </View>
          ))}
        </ScrollView>
      </View>
      <View style={styles.actions}>
        <PageDots index={page} total={SLIDES.length} onChange={goTo} />
        <Button
          label="Get started"
          accessibilityHint="Create a WTW account"
          onPress={() => void start('signup')}
        />
        <Button
          label="Already have an account? Log in"
          accessibilityLabel="Already have an account? Log in"
          variant="link"
          onPress={() => void start('login')}
        />
        <Text style={onboardingStyles.fine}>By continuing, you agree to our</Text>
        <View style={styles.legal}>
          <Button
            label="Terms"
            accessibilityLabel="Terms of Use"
            variant="link"
            onPress={() => void openLegalPage(TERMS_URL, 'Terms of Use')}
          />
          <Text style={onboardingStyles.fine}>and</Text>
          <Button
            label="Privacy Policy"
            variant="link"
            onPress={() => void openLegalPage(PRIVACY_URL, 'Privacy Policy')}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  frame: { flexGrow: 1, justifyContent: 'space-between', gap: space.lg },
  slide: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
    paddingVertical: space.xl,
  },
  actions: { gap: space.xs },
  legal: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -space.sm,
  },
});
