import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface StarRatingProps {
  rating: number | null;
  onChange?: (rating: number | null) => void;
  size?: number;
  readonly?: boolean;
}

function getStarIcon(
  star: number,
  rating: number | null,
): keyof typeof Ionicons.glyphMap {
  if (rating == null || rating < star - 0.75) return 'star-outline';
  if (rating < star - 0.25) return 'star-half';
  return 'star';
}

export function StarRating({
  rating,
  onChange,
  size = 28,
  readonly = false,
}: StarRatingProps) {
  const handlePress = (value: number) => {
    if (readonly || !onChange) return;
    onChange(rating === value ? null : value);
  };

  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((star) => {
        const icon = getStarIcon(star, rating);
        const filled = icon !== 'star-outline';
        return (
          <View key={star} style={{ width: size, height: size }}>
            <Ionicons
              name={icon}
              size={size}
              color={filled ? '#FFD700' : '#555'}
            />
            {!readonly && (
              <>
                {/* Left half → half star */}
                <Pressable
                  style={[styles.half, { width: size / 2, height: size }]}
                  onPress={() => handlePress(star - 0.5)}
                  hitSlop={2}
                />
                {/* Right half → full star */}
                <Pressable
                  style={[
                    styles.half,
                    { width: size / 2, height: size, left: size / 2 },
                  ]}
                  onPress={() => handlePress(star)}
                  hitSlop={2}
                />
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  half: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
