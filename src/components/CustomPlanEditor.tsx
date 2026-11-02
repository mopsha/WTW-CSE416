import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { CUSTOM_TEMPLATES, type CustomOption } from '@shared/domain/customPlans.ts';
import { Button, Chips, colors, MIN_TARGET, space, type } from './index';

const templates: Record<(typeof CUSTOM_TEMPLATES)[number], string[]> = {
  'Game night': ['Board games', 'Card games', 'Video games', 'Charades'],
  Basketball: ['Full court', 'Half court', 'HORSE', 'Shoot around'],
  Cookout: ['Burgers', 'Hot dogs', 'Veggie grill', 'Potluck'],
  'Study session': ['Library', 'Cafe', 'Study lounge', 'Online study room'],
  'House party': ['Dance party', 'Karaoke', 'Theme party', 'Chill hangout'],
  'Movie night': ['Comedy', 'Action', 'Horror', 'Animated movie'],
};
export function CustomPlanEditor({
  options,
  onChange,
}: {
  options: CustomOption[];
  onChange: (options: CustomOption[]) => void;
}) {
  const [template, setTemplate] = useState('');
  const change = (i: number, field: 'name' | 'note', value: string) => {
    setTemplate('');
    onChange(options.map((o, index) => (index === i ? { ...o, [field]: value } : o)));
  };
  return (
    <View style={{ gap: space.md }}>
      <Chips
        options={CUSTOM_TEMPLATES.map((value) => ({ value, label: value }))}
        value={template}
        onChange={(value) => {
          setTemplate(value);
          onChange(templates[value as keyof typeof templates].map((name) => ({ name })));
        }}
        accessibilityLabel="Plan templates"
      />
      {options.map((option, i) => (
        <View key={i} style={{ gap: space.sm }}>
          <TextInput
            style={styles.input}
            value={option.name}
            onChangeText={(value) => change(i, 'name', value)}
            placeholder={`Option ${i + 1}`}
            placeholderTextColor={colors.muted}
            maxLength={60}
            accessibilityLabel={`Option ${i + 1} name`}
          />
          <TextInput
            style={styles.input}
            value={option.note ?? ''}
            onChangeText={(value) => change(i, 'note', value)}
            placeholder="Note (optional)"
            placeholderTextColor={colors.muted}
            maxLength={200}
            accessibilityLabel={`Option ${i + 1} note`}
          />
          <Button
            variant="link"
            label={`Remove option ${i + 1}`}
            disabled={options.length <= 2}
            onPress={() => onChange(options.filter((_, index) => i !== index))}
          />
        </View>
      ))}
      <Button
        variant="secondary"
        label="Add option"
        icon="add"
        disabled={options.length >= 20}
        onPress={() => onChange([...options, { name: '' }])}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  input: {
    ...type.body,
    minHeight: MIN_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: space.md,
    color: colors.text,
    backgroundColor: colors.cardHi,
  },
});
