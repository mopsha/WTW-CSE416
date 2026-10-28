import { Switch, Text, View } from 'react-native';
import { Chips } from './Chips';
import { colors, MIN_TARGET, type } from './theme';

export function PlaceFilterControls({
  priceMax,
  openNow,
  onPrice,
  onOpen,
}: {
  priceMax: number;
  openNow: boolean;
  onPrice: (value: number) => void;
  onOpen: (value: boolean) => void;
}) {
  return (
    <View style={{ gap: 12 }}>
      <Chips
        options={[
          { value: -1, label: 'Any price' },
          ...[0, 1, 2, 3, 4].map((value) => ({
            value,
            label: value === 0 ? 'Free' : '$'.repeat(value),
          })),
        ]}
        value={priceMax}
        onChange={onPrice}
        accessibilityLabel="Maximum price"
      />
      <View
        style={{
          minHeight: MIN_TARGET,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ ...type.body, color: colors.text }}>Open now</Text>
        <Switch
          value={openNow}
          onValueChange={onOpen}
          accessibilityLabel="Only places known to be open now"
        />
      </View>
    </View>
  );
}
