import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {Ionicons} from '@expo/vector-icons';
import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {colors, mono, radius, spacing} from './theme.ts';

export function Screen({children}: {children: React.ReactNode}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, {paddingBottom: insets.bottom + spacing.xxl}]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
      {children}
    </ScrollView>
  );
}

export function Card({
  title,
  subtitle,
  children,
  style,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

export function Banner({
  tone = 'info',
  icon,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  children: React.ReactNode;
}) {
  const toneStyles = {
    info: {bg: colors.accentDim, fg: colors.accent, icon: 'information-circle' as const},
    warning: {bg: colors.warningDim, fg: colors.warning, icon: 'warning' as const},
    danger: {bg: '#3A1E1D', fg: colors.danger, icon: 'alert-circle' as const},
    success: {bg: '#153524', fg: colors.success, icon: 'checkmark-circle' as const},
  }[tone];

  return (
    <View style={[styles.banner, {backgroundColor: toneStyles.bg}]}>
      <Ionicons name={icon ?? toneStyles.icon} size={18} color={toneStyles.fg} />
      <Text style={[styles.bannerText, {color: toneStyles.fg}]}>{children}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  busy?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = disabled || busy;
  const palette = {
    primary: {bg: colors.accent, fg: '#04201F'},
    secondary: {bg: colors.surfaceRaised, fg: colors.text},
    danger: {bg: '#3A1E1D', fg: colors.danger},
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: !!isDisabled, busy: !!busy}}
      onPress={onPress}
      disabled={isDisabled}
      style={({pressed}) => [
        styles.button,
        {backgroundColor: palette.bg, opacity: isDisabled ? 0.5 : pressed ? 0.8 : 1},
      ]}>
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={palette.fg} />
      ) : null}
      <Text style={[styles.buttonLabel, {color: palette.fg}]}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  autoCapitalize = 'none',
  monospace,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'url';
  autoCapitalize?: 'none' | 'characters';
  monospace?: boolean;
  error?: string | null;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={[
          styles.input,
          monospace && {fontFamily: mono},
          multiline && styles.inputMultiline,
          !!error && {borderColor: colors.danger},
        ]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: {value: T; label: string}[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{selected}}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}>
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A label/value row whose value can be copied with one tap. */
export function CopyRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [value]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copy ${label}`}
      onPress={copy}
      style={({pressed}) => [styles.copyRow, pressed && {backgroundColor: colors.surfaceRaised}]}>
      <View style={styles.copyRowText}>
        <Text style={styles.copyRowLabel}>{label}</Text>
        <Text style={styles.copyRowValue} selectable>
          {value || '—'}
        </Text>
        {hint ? <Text style={styles.copyRowHint}>{hint}</Text> : null}
      </View>
      <Ionicons
        name={copied ? 'checkmark' : 'copy-outline'}
        size={18}
        color={copied ? colors.success : colors.textMuted}
      />
    </Pressable>
  );
}

export function Row({children, style}: {children: React.ReactNode; style?: StyleProp<ViewStyle>}) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Muted({children, style}: {children: React.ReactNode; style?: StyleProp<TextStyle>}) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={colors.border} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  screenContent: {padding: spacing.lg, gap: spacing.lg},
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: {color: colors.text, fontSize: 17, fontWeight: '600'},
  cardSubtitle: {color: colors.textMuted, fontSize: 13, marginTop: -spacing.sm, lineHeight: 18},
  banner: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radius.md,
  },
  bannerText: {flex: 1, fontSize: 13, lineHeight: 18},
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    minHeight: 48,
  },
  buttonLabel: {fontSize: 16, fontWeight: '600'},
  field: {gap: spacing.xs},
  fieldLabel: {color: colors.textMuted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6},
  input: {
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  inputMultiline: {minHeight: 96, textAlignVertical: 'top'},
  fieldError: {color: colors.danger, fontSize: 12},
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: radius.sm,
    minHeight: 38,
  },
  segmentSelected: {backgroundColor: colors.surfaceRaised},
  segmentLabel: {color: colors.textMuted, fontSize: 13, fontWeight: '600'},
  segmentLabelSelected: {color: colors.accent},
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginHorizontal: -spacing.sm,
    borderRadius: radius.sm,
  },
  copyRowText: {flex: 1, gap: 2},
  copyRowLabel: {color: colors.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 0.6},
  copyRowValue: {color: colors.text, fontSize: 15, fontFamily: mono},
  copyRowHint: {color: colors.textMuted, fontSize: 11},
  row: {flexDirection: 'row', gap: spacing.sm, alignItems: 'center'},
  muted: {color: colors.textMuted, fontSize: 13, lineHeight: 18},
  empty: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl},
  emptyTitle: {color: colors.text, fontSize: 16, fontWeight: '600'},
  emptyBody: {color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 18},
});
