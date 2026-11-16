import Slider from '@react-native-community/slider';
import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button, colors, MIN_TARGET, Screen, space, type } from '@/components';
import { LocationSearch } from '@/components/LocationSearch';
import { MapPicker } from '@/components/MapPicker';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { haptic } from '@/lib/haptics';
import { milesToMeters } from '@shared/domain/createPick.ts';
import type { LatLng } from '@shared/domain/geo.ts';

export interface PickLocation {
  center: LatLng;
  label: string;
  miles: number;
}
/** Mounted only while open. Closing destroys drafts and invalidates location requests. */
export function NewPickLocationEditor({
  initial,
  onCancel,
  onApply,
}: {
  initial: PickLocation;
  onCancel: () => void;
  onApply: (value: PickLocation) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const heading = useRef<Text>(null);
  const reduced = useMotionPreference();
  const { height, width } = useWindowDimensions();
  const landscape = width > height;
  // Keep the map outside scroll gestures. Small/landscape screens can scroll the
  // search and radius controls independently without covering map attribution.
  const mapHeight = Math.min(
    expanded ? 320 : 200,
    Math.max(100, height * (expanded ? 0.45 : 0.28)),
  );
  const cancel = () => {
    Keyboard.dismiss();
    onCancel();
  };
  const search = (
    <>
      <Text style={s.body}>
        {draft.label} · {draft.miles} mi
      </Text>
      <LocationSearch
        label={draft.label}
        key={selectionVersion}
        onPick={(center, label) => setDraft((d) => ({ ...d, center, label }))}
      />
    </>
  );
  const map = (
    <>
      <View style={s.map}>
        <MapPicker
          center={draft.center}
          radiusM={milesToMeters(draft.miles)}
          height={mapHeight}
          onChangeCenter={(center) => {
            Keyboard.dismiss();
            setSelectionVersion((v) => v + 1);
            setDraft((d) => ({ ...d, center, label: 'Dropped pin' }));
          }}
        />
      </View>
    </>
  );
  const radiusControls = (
    <>
      <Pressable
        onPress={() => {
          Keyboard.dismiss();
          setExpanded((v) => !v);
        }}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Collapse map' : 'Expand map'}
        accessibilityState={{ expanded }}
        style={s.action}
      >
        <Text style={s.actionText}>{expanded ? 'Collapse map' : 'Expand map'}</Text>
      </Pressable>
      <Text style={s.body}>Search radius · {draft.miles} mi</Text>
      <Slider
        minimumValue={0.5}
        maximumValue={10}
        step={0.5}
        value={draft.miles}
        onValueChange={(miles) => setDraft((d) => ({ ...d, miles }))}
        onSlidingComplete={() => haptic.tick()}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.primary}
        style={s.slider}
        accessibilityLabel="Search radius in miles"
        accessibilityValue={{
          min: 0.5,
          max: 10,
          now: draft.miles,
          text: `${draft.miles} miles`,
        }}
      />
    </>
  );
  return (
    <Modal
      visible
      presentationStyle="fullScreen"
      animationType={reduced ? 'none' : 'slide'}
      onRequestClose={cancel}
      onShow={() => {
        if (Platform.OS === 'web') {
          // TextProps does not include tabIndex in native-only typechecks.
          // On web the ref is a DOM element; make only that element focusable.
          if (typeof HTMLElement !== 'undefined' && heading.current instanceof HTMLElement) {
            heading.current.setAttribute('tabindex', '-1');
            heading.current.focus();
          }
        } else if (heading.current)
          AccessibilityInfo.sendAccessibilityEvent(heading.current, 'focus');
      }}
    >
      <Screen scroll={false} contentStyle={s.frame}>
        <View onAccessibilityEscape={cancel} style={s.fill} accessibilityViewIsModal>
          <View style={s.header}>
            <Text ref={heading} accessible style={s.heading} accessibilityRole="header">
              Where
            </Text>
            <Button label="Cancel" variant="link" onPress={cancel} />
          </View>
          {landscape ? (
            <View style={s.landscape}>
              <ScrollView
                style={s.fill}
                contentContainerStyle={s.controls}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                {search}
                {radiusControls}
              </ScrollView>
              <View style={s.fill}>{map}</View>
            </View>
          ) : (
            <>
              <ScrollView
                style={s.fill}
                contentContainerStyle={s.controls}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                {search}
              </ScrollView>
              {map}
              <ScrollView
                style={s.radiusScroll}
                contentContainerStyle={s.controls}
                keyboardShouldPersistTaps="handled"
              >
                {radiusControls}
              </ScrollView>
            </>
          )}
          <View style={s.controls}>
            <Button
              label="Use this location"
              onPress={() => {
                Keyboard.dismiss();
                onApply(draft);
              }}
            />
          </View>
        </View>
      </Screen>
    </Modal>
  );
}
const s = StyleSheet.create({
  frame: { padding: 0, paddingBottom: 0, gap: 0 },
  fill: { flex: 1 },
  landscape: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  header: {
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  heading: { ...type.heading, color: colors.text, flex: 1 },
  body: { ...type.body, color: colors.text },
  controls: { padding: space.lg, gap: space.sm },
  map: { paddingHorizontal: space.lg },
  radiusScroll: { flexGrow: 0, flexShrink: 1 },
  slider: { minHeight: MIN_TARGET },
  action: { minHeight: MIN_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
  actionText: { ...type.body, color: colors.primary },
});
