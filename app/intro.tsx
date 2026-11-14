import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import {
  Button,
  colors,
  fonts,
  Illustration,
  type IllustrationBadge,
  MIN_TARGET,
  OnboardingCopy,
  PageDots,
  Screen,
  space,
  type,
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

const CAPTION_LINE = 18;
/** Inline links stay caption-sized; hitSlop makes each one a 44-pt tall target. */
const LINK_SLOP = {
  top: (MIN_TARGET - CAPTION_LINE) / 2,
  bottom: (MIN_TARGET - CAPTION_LINE) / 2,
  left: space.sm,
  right: space.sm,
};
const LEAD_WORDS = 'By continuing, you agree to our'.split(' ');

// Signed-out first run only: the root layout lists this before sign-in until it's been seen.
export default function IntroScreen() {
  const { height } = useWindowDimensions();
  const [page, setPage] = useState(0);
  // The pager's measured width, not the window's: on web the window is wider than the column
  // (scrollbars, desktop browsers), and window-wide slides pushed the whole screen off-edge.
  const [pageWidth, setPageWidth] = useState(0);
  const pager = useRef<ScrollView>(null);
  const leaving = useRef(false);
  const artSize = height < 700 ? 160 : 200;

  function onLayout(e: LayoutChangeEvent) {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== pageWidth) {
      setPageWidth(w);
      // Keep the current slide in view after a resize or rotation.
      pager.current?.scrollTo({ x: page * w, animated: false });
    }
  }

  // Runs during swipes and programmatic scrolls (react-native-web never fires
  // onMomentumScrollEnd), so the active dot always follows the visible slide.
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!pageWidth) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    setPage(Math.min(Math.max(next, 0), SLIDES.length - 1));
  }

  function goTo(index: number) {
    setPage(index);
    pager.current?.scrollTo({ x: index * pageWidth, animated: true });
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
      <View style={styles.hero}>
        <View style={styles.pager} onLayout={onLayout} testID="intro-pager">
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onScroll}
            onMomentumScrollEnd={onScroll}
            accessibilityLabel="WTW intro"
          >
            {SLIDES.map((slide) => (
              <View
                key={slide.key}
                style={[styles.slide, pageWidth ? { width: pageWidth } : styles.unmeasured]}
                testID={`intro-slide-${slide.key}`}
              >
                <Illustration icon={slide.icon} badges={slide.badges} size={artSize} />
                <OnboardingCopy title={slide.title} body={slide.body} />
              </View>
            ))}
          </ScrollView>
        </View>
        <PageDots index={page} total={SLIDES.length} onChange={goTo} />
      </View>
      <View style={styles.actions}>
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
        <View style={styles.legal}>
          {LEAD_WORDS.map((word) => (
            <Text key={word} style={styles.caption}>
              {word}{' '}
            </Text>
          ))}
          {/* Kept on one line so the two links never stack and their tap areas never overlap. */}
          <View style={styles.links}>
            <Pressable
              onPress={() => void openLegalPage(TERMS_URL, 'Terms of Use')}
              hitSlop={LINK_SLOP}
              accessibilityRole="link"
              accessibilityLabel="Terms of Use"
            >
              <Text style={[styles.caption, styles.link]}>Terms</Text>
            </Pressable>
            <Text style={styles.caption}> and </Text>
            <Pressable
              onPress={() => void openLegalPage(PRIVACY_URL, 'Privacy Policy')}
              hitSlop={LINK_SLOP}
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
            >
              <Text style={[styles.caption, styles.link]}>Privacy Policy</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  frame: { flexGrow: 1, gap: space.lg },
  // Slides and dots stay together; spare height goes around the group, not inside it.
  hero: { flex: 1, justifyContent: 'center', gap: space.sm },
  // minWidth 0 + overflow hidden: the pager never grows to fit its row of slides.
  pager: { alignSelf: 'stretch', minWidth: 0, overflow: 'hidden' },
  slide: { alignItems: 'center', justifyContent: 'center', gap: space.lg },
  unmeasured: { width: '100%' },
  actions: { gap: space.xs },
  legal: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    paddingTop: space.sm,
  },
  links: { flexDirection: 'row' },
  caption: { ...type.caption, lineHeight: CAPTION_LINE, color: colors.muted },
  link: { fontFamily: fonts.semibold, color: colors.primary },
});
