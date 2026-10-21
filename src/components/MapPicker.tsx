import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, type LatLng as MapLatLng } from 'react-native-maps';

import type { LatLng } from '@shared/domain/geo.ts';

import { colors, radius } from './theme';

export interface MapPickerProps {
  center: LatLng;
  radiusM: number;
  onChangeCenter: (center: LatLng) => void;
  height?: number;
}

const toCoord = ({ lat, lng }: LatLng) => ({ latitude: lat, longitude: lng });

/**
 * Map with a draggable pin and the search radius as a circle. Tap anywhere to move the pin.
 * Web has its own fallback (MapPicker.web.tsx) because react-native-maps is native only.
 */
export function MapPicker({ center, radiusM, onChangeCenter, height = 240 }: MapPickerProps) {
  const map = useRef<MapView>(null);

  // Keep the whole circle in view when the pin or radius changes.
  useEffect(() => {
    const latDelta = (radiusM * 2.6) / 111_320;
    const lngDelta = latDelta / Math.max(0.2, Math.cos((center.lat * Math.PI) / 180));
    map.current?.animateToRegion(
      { ...toCoord(center), latitudeDelta: latDelta, longitudeDelta: lngDelta },
      250,
    );
  }, [center, radiusM]);

  // Map taps and pin drags both report the new spot as nativeEvent.coordinate.
  const move = (e: { nativeEvent: { coordinate: MapLatLng } }) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    onChangeCenter({ lat: latitude, lng: longitude });
  };

  return (
    <View
      style={[styles.wrap, { height }]}
      accessibilityLabel="Map. Tap or drag the pin to set where the Pick is centered."
    >
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...toCoord(center), latitudeDelta: 0.08, longitudeDelta: 0.08 }}
        userInterfaceStyle="dark"
        onPress={move}
        showsUserLocation
        toolbarEnabled={false}
      >
        <Circle
          center={toCoord(center)}
          radius={radiusM}
          strokeColor={colors.primary}
          strokeWidth={2}
          fillColor="rgba(255, 79, 109, 0.15)"
        />
        <Marker
          coordinate={toCoord(center)}
          draggable
          onDragEnd={move}
          pinColor={colors.primary}
          title="Pick center"
        />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
});
