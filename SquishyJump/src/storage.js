import AsyncStorage from '@react-native-async-storage/async-storage';

const BEST_KEY = 'squishyjump.best';
const PICK_KEY = 'squishyjump.pick';

export async function loadSaved() {
  try {
    const [[, best], [, pick]] = await AsyncStorage.multiGet([BEST_KEY, PICK_KEY]);
    return { best: Number(best) || 0, pick: pick || null };
  } catch {
    return { best: 0, pick: null };
  }
}

export const saveBest = (n) => AsyncStorage.setItem(BEST_KEY, String(n)).catch(() => {});
export const savePick = (id) => AsyncStorage.setItem(PICK_KEY, id).catch(() => {});
